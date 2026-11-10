import { PDFDocument } from "pdf-lib";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

// Google Drive backup, against the test database and a fake Drive API that
// keeps its folders and files in memory. PDFs and Word files are stand-ins:
// how they're drawn is tested with Download.

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({
  env: { DOSSIER_SECRET: "s".repeat(40), DOSSIER_GOOGLE_CLIENT_ID: "client", DOSSIER_GOOGLE_CLIENT_SECRET: "secret", DOSSIER_DATA_DIR: "/tmp" },
}));
const pages = vi.hoisted(() => ({ rendered: [] as string[] }));
vi.mock("@/lib/pdf/render", () => ({
  renderPdf: async (path: string) => {
    pages.rendered.push(path);
    const pdf = await PDFDocument.create();
    pdf.addPage();
    return pdf.save();
  },
}));
vi.mock("@/lib/docx/application-docx", () => ({ sentDocx: async () => ({ file: new TextEncoder().encode("word file"), fileName: "x.docx" }) }));
const jobs = vi.hoisted(() => ({ started: [] as unknown[] }));
vi.mock("@/lib/jobs/runner", () => ({
  defineJob: <T,>(definition: T) => definition,
  startJob: async (_definition: unknown, input: unknown) => {
    jobs.started.push(input);
    return "job-1";
  },
}));

import { ApplicationStatus, DocumentKind, FileFormat } from "@/generated/prisma/enums";
import { encryptSecret, GOOGLE_TOKEN } from "@/lib/secrets";
import { saveSettings } from "@/lib/settings-data";
import { rememberDownloadFormat } from "@/lib/sent-documents";
import { applyStatusChange } from "@/lib/status-changes";

import { applicationFolderName, driveBackupJob, safeName } from "./drive-backup";

const prisma = () => db.client!;
const DRIVE = "https://www.googleapis.com/auth/drive.file";

type Item = { id: string; name: string; parent: string | null; folder: boolean; type: string; size: number; trashed: boolean; data: Uint8Array };
let drive: Map<string, Item>;
let refuseUploads: boolean;

/** The fake Drive's folders and files under `parent`, by name. */
const inside = (parent: string | null) =>
  [...drive.values()].filter((item) => item.parent === parent && !item.trashed).map((item) => item.name).sort();
const folderNamed = (name: string) => [...drive.values()].find((item) => item.folder && item.name === name && !item.trashed)!;

beforeEach(async () => {
  await resetDatabase(prisma());
  drive = new Map();
  refuseUploads = false;
  pages.rendered = [];
  jobs.started = [];
  let next = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = new URL(String(url));
      const method = init?.method ?? "GET";
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (href.href.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "access", expires_in: 3600 });
      if (method === "POST" && href.pathname === "/drive/v3/files") {
        const body = JSON.parse(String(init!.body)) as { name: string; parents?: string[] };
        const id = `f${++next}`;
        drive.set(id, { id, name: body.name, parent: body.parents?.[0] ?? null, folder: true, type: "folder", size: 0, trashed: false, data: new Uint8Array() });
        return json({ id });
      }
      if (method === "POST" && href.pathname === "/upload/drive/v3/files") {
        if (refuseUploads) return json({ error: { code: 403, message: "storageQuotaExceeded" } }, 403);
        const body = Buffer.from(init!.body as Uint8Array);
        const text = body.toString("latin1");
        const meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n/.exec(body.toString("utf8"))![1]) as { name: string; parents: string[] };
        const type = /Content-Type: ([^\r]+)\r\n\r\n(?!\{)/.exec(text)![1];
        const start = text.indexOf("\r\n\r\n", text.indexOf(`Content-Type: ${type}`)) + 4;
        const end = text.lastIndexOf("\r\n--");
        const id = `f${++next}`;
        drive.set(id, { id, name: meta.name, parent: meta.parents[0], folder: false, type, size: end - start, trashed: false, data: body.subarray(start, end) });
        return json({ id });
      }
      const got = /^\/drive\/v3\/files\/([^/]+)$/.exec(href.pathname);
      if (method === "GET" && got) {
        const item = drive.get(decodeURIComponent(got[1]));
        return item ? json({ id: item.id, trashed: item.trashed }) : json({ error: { code: 404 } }, 404);
      }
      return json({ error: { code: 404 } }, 404);
    }),
  );
  await prisma().googleAccount.create({
    data: { email: "jane@gmail.com", refreshTokenEnc: encryptSecret(GOOGLE_TOKEN, "refresh", "s".repeat(40)), scopes: `openid email ${DRIVE}` },
  });
  await prisma().application.create({
    data: {
      id: "nw",
      company: "Northwind",
      role: "Product Designer",
      postingUrl: "https://jobs.example.com/1",
      postingText: "We're hiring a product designer.\nYou'll own our design system.",
      documents: { create: [{ kind: DocumentKind.RESUME, units: [] }, { kind: DocumentKind.COVER_LETTER, units: [] }] },
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => prisma().$disconnect());

const run = () => driveBackupJob.run({ applicationId: "nw" }, { id: "job-1", step: async () => {}, signal: new AbortController().signal });
const send = () => applyStatusChange(prisma(), "nw", ApplicationStatus.SENT, new Date("2026-11-04T15:00:00Z"));

describe("Google Drive backup: names", () => {
  it("names each application's folder Company – Role, safe for any file system", () => {
    expect(applicationFolderName({ company: "Northwind", role: "Product Designer", title: "" })).toBe("Northwind – Product Designer");
    expect(applicationFolderName({ company: "Acme / Labs", role: "", title: "Engineer: Platform" })).toBe("Acme Labs – Engineer Platform");
    expect(applicationFolderName({ company: "", role: "", title: "" })).toBe("Application");
    expect(safeName("..hidden")).toBe("hidden");
  });
});

describe("Google Drive backup: what a send saves", () => {
  it("keeps each copy in the format last downloaded, and starts the backup only when it's on and allowed", async () => {
    await rememberDownloadFormat("nw", FileFormat.DOCX);
    await send();
    const copies = await prisma().sentDocument.findMany({ where: { applicationId: "nw" } });
    expect(copies.map((copy) => copy.format)).toEqual([FileFormat.DOCX, FileFormat.DOCX]);
    expect(jobs.started).toEqual([{ applicationId: "nw" }]);

    // Switched off: a send is kept, and nothing goes to Drive.
    jobs.started = [];
    await prisma().application.create({ data: { id: "off", company: "Off", documents: { create: [{ kind: DocumentKind.RESUME, units: [] }] } } });
    await saveSettings({ driveBackup: false });
    await applyStatusChange(prisma(), "off", ApplicationStatus.SENT);
    expect(jobs.started).toEqual([]);
  });

  it("leaves archived applications out of the Drive", async () => {
    await prisma().application.update({ where: { id: "nw" }, data: { archivedAt: new Date() } });
    await send();
    expect(jobs.started).toEqual([]);
  });

  it("leaves sample applications out of the Drive", async () => {
    await prisma().setting.create({
      data: { key: "sampleData", value: JSON.stringify({ loadedAt: new Date().toISOString(), ids: { application: ["nw"] }, profileFields: [] }) },
    });
    await send();
    expect(await prisma().sentDocument.count()).toBe(2);
    expect(jobs.started).toEqual([]);
  });

  it("is a PDF when nothing was downloaded, or when Gmail sent it", async () => {
    await rememberDownloadFormat("nw", FileFormat.DOCX);
    await applyStatusChange(prisma(), "nw", ApplicationStatus.SENT, new Date(), { sentFormat: FileFormat.PDF });
    expect((await prisma().sentDocument.findMany()).map((copy) => copy.format)).toEqual([FileFormat.PDF, FileFormat.PDF]);
  });
});

describe("Google Drive backup: the job", () => {
  it("makes the main folder and the application's, with the posting and each file as it went out, once", async () => {
    await rememberDownloadFormat("nw", FileFormat.DOCX);
    await send();
    await prisma().sentDocument.updateMany({ where: { kind: DocumentKind.RESUME }, data: { format: FileFormat.PDF } });

    const result = await run();
    expect(inside(null)).toEqual(["Job search 2026-27"]);
    const root = folderNamed("Job search 2026-27");
    expect(inside(root.id)).toEqual(["Northwind – Product Designer"]);
    const folder = folderNamed("Northwind – Product Designer");
    const files = [...drive.values()].filter((item) => item.parent === folder.id);
    expect(files.map((file) => [file.name.endsWith(".pdf") ? "pdf" : "docx", file.type]).sort()).toEqual([
      ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["pdf", "application/pdf"],
    ]);
    expect(files.some((file) => file.name === "Northwind – Product Designer – Job description.docx")).toBe(true);
    expect(result).toEqual({ folderUrl: `https://drive.google.com/drive/folders/${folder.id}`, files: 3 });

    const application = await prisma().application.findUniqueOrThrow({ where: { id: "nw" }, include: { notes: true, sentDocuments: true } });
    expect(application.driveFolderId).toBe(folder.id);
    expect(application.sentDocuments.every((copy) => copy.driveFileId)).toBe(true);
    expect(application.notes.map((note) => note.body)).toEqual(["Saved to Google Drive: Job search 2026-27 / Northwind – Product Designer"]);

    // Run again: nothing new to save, nothing saved twice.
    expect(await run()).toMatchObject({ files: 0 });
    expect([...drive.values()].filter((item) => item.parent === folder.id)).toHaveLength(3);
  });

  it("puts the cover letter and resume in one PDF, the letter first, when that's chosen", async () => {
    await saveSettings({ driveCombine: true });
    await send();
    await run();
    const folder = folderNamed("Northwind – Product Designer");
    const combined = [...drive.values()].filter((item) => item.parent === folder.id && item.type === "application/pdf");
    expect(combined).toHaveLength(1);
    expect(combined[0].name).toMatch(/ with cover letter\.pdf$/);
    expect((await PDFDocument.load(combined[0].data)).getPageCount()).toBe(2);
    const [letter, resume] = await Promise.all(
      [DocumentKind.COVER_LETTER, DocumentKind.RESUME].map((kind) => prisma().sentDocument.findFirstOrThrow({ where: { kind } })),
    );
    expect(pages.rendered).toEqual([`/print/sent/${letter.id}`, `/print/sent/${resume.id}`]);
  });

  it("starts a new main folder when it's renamed, and a deleted folder is made again with everything in it", async () => {
    await send();
    await run();
    folderNamed("Northwind – Product Designer").trashed = true;
    await saveSettings({ driveFolderName: "Job search 2027-28" });
    await run();
    expect(inside(null)).toEqual(["Job search 2026-27", "Job search 2027-28"]);
    const folder = [...drive.values()].find((item) => item.name === "Northwind – Product Designer" && !item.trashed)!;
    expect(folder.parent).toBe(folderNamed("Job search 2027-28").id);
    expect(inside(folder.id)).toHaveLength(3);
  });

  it("notes why it didn't work, and clears that once it does", async () => {
    await send();
    refuseUploads = true;
    await expect(run()).rejects.toThrow();
    expect((await prisma().application.findUniqueOrThrow({ where: { id: "nw" } })).driveProblem).toMatch(/Drive may be full/);
    refuseUploads = false;
    await run();
    expect((await prisma().application.findUniqueOrThrow({ where: { id: "nw" } })).driveProblem).toBeNull();
  });
});
