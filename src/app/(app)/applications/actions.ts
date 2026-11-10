"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { EmployerType } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { activityTimeline } from "@/lib/activity";
import { FILTERS, SORT_KEYS, VIEWS } from "@/lib/applications-list";
import { APPLIED_VIA_OPTIONS } from "@/lib/applied-via";
import { sheetReady, syncSheet } from "@/lib/applications-sheet";
import { prisma } from "@/lib/prisma";
import { saveSettings } from "@/lib/settings-data";
import { userTimeZone } from "@/lib/time-zone";

/** Remembers how the Applications screen was left (LST-7), for the next visit. */
export const rememberListView = action(
  z.object({
    view: z.enum(VIEWS),
    filter: z.enum(FILTERS.map((filter) => filter.value)),
    sort: z.object({ key: z.enum(SORT_KEYS), reversed: z.boolean() }),
  }),
  async ({ view, filter, sort }) => {
    await saveSettings({
      applicationsView: view,
      applicationsFilter: filter,
      applicationsSort: `${sort.reversed ? "-" : ""}${sort.key}`,
    });
    return null;
  },
);

/**
 * The Government or Startup label, as the user sets it from the ⋯ menu:
 * Private company shows none, and null goes back to Scout's own guess.
 */
export const setEmployerType = action(
  z.object({ id: z.string().min(1), type: z.enum(EmployerType).nullable() }),
  async ({ id, type }) => {
    const { count } = await prisma.application.updateMany({ where: { id }, data: { employerType: type } });
    if (count === 0) throw new ActionError("That application no longer exists.");
    revalidatePath("/applications");
    return null;
  },
);

/** Applied Using: the platform picked in the row's menu; null goes back to Scout's guess. */
export const setAppliedVia = action(
  z.object({ id: z.string().min(1), via: z.enum(APPLIED_VIA_OPTIONS).nullable() }),
  async ({ id, via }) => {
    const { count } = await prisma.application.updateMany({ where: { id }, data: { appliedVia: via } });
    if (count === 0) throw new ActionError("That application no longer exists.");
    revalidatePath("/applications");
    return null;
  },
);

/** Things To Note: the role's lasting notes, as typed in the row's pop-up. */
export const saveThingsToNote = action(
  z.object({ id: z.string().min(1), text: z.string().max(2000, "Keep it to 2,000 characters.") }),
  async ({ id, text }) => {
    const { count } = await prisma.application.updateMany({ where: { id }, data: { thingsToNote: text.trim() } });
    if (count === 0) throw new ActionError("That application no longer exists.");
    revalidatePath("/applications");
    return null;
  },
);

/** Sync To Google Sheets: replaces the log's Google Sheet with the table as it is now, making it the first time. */
export const syncApplicationsSheet = action(z.object({}), async (_input, { toast }) => {
  if (!(await sheetReady())) throw new ActionError("Allow Google Drive in Settings → Google first.");
  const url = await syncSheet();
  revalidatePath("/applications");
  toast("Synced to Google Sheets.");
  return { url };
});

/** Everything that happened to an application, newest first, as its Activity tab shows it: for More in the log's Activity column. */
export const loadActivity = action(z.object({ id: z.string().min(1) }), async ({ id }) => {
  const application = await prisma.application.findUnique({
    where: { id },
    select: {
      createdAt: true,
      notes: true,
      events: { select: { id: true, to: true, at: true } },
      sentDocuments: { select: { id: true, kind: true, eventId: true, sentAt: true } },
    },
  });
  if (!application) throw new ActionError("That application no longer exists.");
  return activityTimeline({ ...application, timeZone: await userTimeZone() });
});
