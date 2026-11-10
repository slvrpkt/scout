import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { demoLetterUnits, demoResumeUnits } from "@/lib/demo-profile";
import { createTestClient, resetDatabase } from "@/test/db";

import { loadDocuments, loadSentDocument } from "./application-documents";
import { applyStatusChange, undoStatusChange } from "./status-changes";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const client = () => db.client!;

beforeEach(() => resetDatabase(client()));
afterAll(() => client().$disconnect());

async function sentApplication() {
  await client().profileField.create({ data: { key: "name", value: "Before Sending" } });
  await client().theme.create({ data: { id: "mine", name: "Mine", headFont: "GEIST", bodyFont: "GEIST", accent: "#111111" } });
  const { id } = await client().application.create({
    data: {
      company: "Ledgerly",
      role: "Project Manager",
      postingUrl: "https://example.com/jobs/1",
      documents: {
        create: [
          { kind: "RESUME", units: demoResumeUnits(), themeId: "mine" },
          { kind: "COVER_LETTER", units: demoLetterUnits(), themeId: "mine" },
        ],
      },
    },
  });
  const change = await applyStatusChange(client(), id, "SENT", new Date());
  return { id, change };
}

describe("sent copies", () => {
  it("stay as they went out when the profile, the theme and the document change, and only they show", async () => {
    const { id } = await sentApplication();
    await client().profileField.update({ where: { key: "name" }, data: { value: "Changed Later" } });
    await client().theme.update({ where: { id: "mine" }, data: { accent: "#ff0000" } });
    await client().document.updateMany({ where: { applicationId: id, kind: "RESUME" }, data: { units: [] } });

    const shown = await loadDocuments(id);
    expect(shown.frozen).toBe(true);
    expect(shown.profile.basics.name).toBe("Before Sending");
    expect(shown.resume?.theme.accent).toBe("#111111");
    expect(shown.resume?.units.length).toBeGreaterThan(0);

    const copy = await client().sentDocument.findFirstOrThrow({ where: { applicationId: id, kind: "RESUME" } });
    const sent = await loadSentDocument(copy.id);
    expect(sent?.profile.basics.name).toBe("Before Sending");
    expect(sent?.document.theme.accent).toBe("#111111");
  });

  it("go when the send is undone, and the draft refreshes again", async () => {
    const { id, change } = await sentApplication();
    if (change.outcome !== "changed") throw new Error("not sent");
    await undoStatusChange(client(), change.event.id);
    await client().profileField.update({ where: { key: "name" }, data: { value: "Changed Later" } });
    const shown = await loadDocuments(id);
    expect(shown.frozen).toBe(false);
    expect(shown.profile.basics.name).toBe("Changed Later");
  });
});
