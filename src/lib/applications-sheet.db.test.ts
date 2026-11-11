import { strFromU8, unzipSync } from "fflate";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

// The Job application log's Google Sheet, against the test database and a
// fake Drive API that keeps its files in memory.

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({
  env: { DOSSIER_SECRET: "s".repeat(40), DOSSIER_GOOGLE_CLIENT_ID: "client", DOSSIER_GOOGLE_CLIENT_SECRET: "secret", DOSSIER_DATA_DIR: "/tmp" },
}));
vi.mock("@/lib/time-zone", () => ({ userTimeZone: async () => "America/New_York", lastKnownTimeZone: async () => "America/New_York" }));
vi.mock("@/lib/jobs/runner", () => ({ defineJob: <T,>(definition: T) => definition, startJob: vi.fn() }));

import { encryptSecret, GOOGLE_TOKEN } from "@/lib/secrets";
import { loadSettings, saveSettings } from "@/lib/settings-data";

import { queueSheetSync, syncSheet } from "./applications-sheet";

const prisma = () => db.client!;

type File = { id: string; name: string; parent: string | null; type: string; csv: string; trashed: boolean };
let drive: Map<string, File>;
let calls: string[];

beforeEach(async () => {
  await resetDatabase(prisma());
  drive = new Map();
  calls = [];
  let next = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = new URL(String(url));
      const method = init?.method ?? "GET";
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (href.href.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "access", expires_in: 3600 });
      calls.push(`${method} ${href.pathname}`);
      if (method === "POST" && href.pathname === "/drive/v3/files") {
        const body = JSON.parse(String(init!.body)) as { name: string; parents?: string[] };
        const id = `f${++next}`;
        drive.set(id, { id, name: body.name, parent: body.parents?.[0] ?? null, type: "folder", csv: "", trashed: false });
        return json({ id });
      }
      if (method === "POST" && href.pathname === "/upload/drive/v3/files") {
        const raw = Buffer.from(init!.body as Uint8Array);
        const text = raw.toString("latin1");
        const meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n/.exec(text)![1]) as { name: string; parents: string[]; mimeType?: string };
        const start = text.indexOf("\r\n\r\n", text.indexOf("Content-Type: application/vnd.openxmlformats")) + 4;
        const id = `f${++next}`;
        drive.set(id, { id, name: meta.name, parent: meta.parents[0], type: meta.mimeType ?? "", csv: asCsv(raw.subarray(start, text.lastIndexOf("\r\n--"))), trashed: false });
        return json({ id });
      }
      const replaced = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(href.pathname);
      if (method === "PATCH" && replaced) {
        drive.get(replaced[1])!.csv = asCsv(Buffer.from(init!.body as Uint8Array));
        return json({ id: replaced[1] });
      }
      const got = /^\/drive\/v3\/files\/([^/]+)$/.exec(href.pathname);
      if (method === "GET" && got) {
        const item = drive.get(got[1]);
        return item ? json({ id: item.id, trashed: item.trashed }) : json({ error: { code: 404 } }, 404);
      }
      return json({ error: { code: 404 } }, 404);
    }),
  );
  await prisma().googleAccount.create({
    data: { email: "jane@gmail.com", refreshTokenEnc: encryptSecret(GOOGLE_TOKEN, "refresh", "s".repeat(40)), scopes: "openid email https://www.googleapis.com/auth/drive.file" },
  });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => prisma().$disconnect());

/** An uploaded Excel sheet's cells as text, a line per row, for checking what went in. */
function asCsv(xlsx: Uint8Array): string {
  const sheet = strFromU8(unzipSync(xlsx)["xl/worksheets/sheet1.xml"]);
  return [...sheet.matchAll(/<row [^>]*>(.*?)<\/row>/g)]
    .map(([, row]) => [...row.matchAll(/<c [^>]*>(.*?)<\/c>/g)].map(([, cell]) => (/<t[^>]*>(.*?)<\/t>/.exec(cell) ?? /<v>(.*?)<\/v>/.exec(cell))?.[1] ?? "").map((text) => text.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")).join(","))
    .join("\r\n");
}

const sheets = () => [...drive.values()].filter((file) => file.type === "application/vnd.google-apps.spreadsheet");
const lines = (csv: string) => csv.split("\r\n").map((line) => line.split(",")[1]);

describe("syncing the log to Google Sheets", () => {
  it("makes the sheet in the main folder with only what was sent and isn't archived, then replaces it in place", async () => {
    const sent = new Date("2026-11-02T15:00:00Z");
    await prisma().application.createMany({
      data: [
        { id: "a", company: "Northwind", role: "Product Designer", status: "SENT", sentAt: sent, furthestStage: "SENT" },
        { id: "b", company: "Kestrel", role: "Researcher", status: "REJECTED", sentAt: sent, furthestStage: "SENT", archivedAt: sent },
        { id: "draft", company: "Never Sent", role: "Draft role" },
        { id: "sample", company: "Sample Co", role: "Sample role", status: "SENT", sentAt: sent, furthestStage: "SENT" },
      ],
    });
    await prisma().setting.create({ data: { key: "sampleData", value: JSON.stringify({ loadedAt: sent.toISOString(), ids: { application: ["sample"] }, profileFields: [] }) } });

    const url = await syncSheet(new Date("2026-11-04T12:00:00Z"));
    const [sheet] = sheets();
    expect(sheet.name).toBe("Job application log");
    expect(drive.get(sheet.parent!)!.name).toBe("Job search 2026-27");
    expect(url).toBe(`https://docs.google.com/spreadsheets/d/${sheet.id}/edit`);
    expect(lines(sheet.csv).sort()).toEqual(["Product Designer", "Role"]);
    // Archived stays out: the sheet is only what you applied for and still pursue.
    expect(sheet.csv).not.toContain("Kestrel");

    // The next sync keeps the file and its link, and replaces what's in it.
    await prisma().application.update({ where: { id: "a" }, data: { status: "INTERVIEW" } });
    expect(await syncSheet(new Date("2026-11-05T12:00:00Z"))).toBe(url);
    expect(sheets()).toHaveLength(1);
    expect(calls.filter((call) => call.startsWith("PATCH"))).toHaveLength(1);
    expect(sheet.csv).toContain("Interview");
    expect((await loadSettings()).driveSheetSyncedAt).toBe("2026-11-05T12:00:00.000Z");
  });

  it("updates on its own a few seconds after a change, several changes making one sync", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      queueSheetSync();
      queueSheetSync();
      expect(sheets()).toEqual([]);
      await vi.advanceTimersByTimeAsync(5_000);
    } finally {
      vi.useRealTimers();
    }
    await vi.waitFor(() => expect(sheets()).toHaveLength(1));
  });

  it("keeps a blank sheet, just the header, while nothing was sent", async () => {
    await syncSheet();
    await syncSheet();
    expect(sheets()).toHaveLength(1);
    expect(sheets()[0].csv).toBe("Company,Role,Salary,Posting Link,Source,Employer,Posted,Apply By,Location,Things To Note,Applied Using,Status,Applied,Resume & Cover Letter,Job Description,Activity,Updated");
  });

  it("makes a new sheet in a renamed main folder, or when the old one was deleted", async () => {
    await syncSheet();
    sheets()[0].trashed = true;
    await syncSheet();
    await saveSettings({ driveFolderName: "Job search 2027-28" });
    await syncSheet();
    const live = sheets().filter((file) => !file.trashed);
    expect(live.map((file) => drive.get(file.parent!)!.name)).toEqual(["Job search 2026-27", "Job search 2027-28"]);
  });
});
