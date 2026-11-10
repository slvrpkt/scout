import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSession } from "@/lib/auth/session";
import { demoProfile } from "@/lib/demo-profile";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { settingsFromRows } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";

import { GET as GET_HELD } from "./[id]/route";
import { GET, POST } from "./route";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/profile-data", () => ({ loadProfile: vi.fn() }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: vi.fn() }));
vi.mock("@/lib/base-resume-fit", () => ({ fittedBaseResume: vi.fn(async () => new Uint8Array()), baseLengthOf: vi.fn(async () => "2"), baseResumeDocx: vi.fn(async () => new Uint8Array([80, 75])) }));
vi.mock("@/lib/base-resume", () => ({ BASE_LENGTH_PAGES: { full: null, "2": 2, "3": 3 }, versionAt: vi.fn(() => ({ condense: { bullets: {}, leftOut: [] }, dropped: [], steps: 0 })) }));
vi.mock("@/lib/theme-data", () => ({ loadTheme: vi.fn().mockResolvedValue(null), THEME_FIELDS: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: { application: { count: vi.fn(), updateMany: vi.fn() } } }));

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const get = (query: string) => GET(new NextRequest(`http://localhost:3000/api/docx${query}`), undefined);
const post = (query: string) =>
  POST(
    new NextRequest(`http://localhost:3000/api/docx${query}`, { method: "POST", headers: { origin: "http://localhost:3000", host: "localhost:3000" } }),
    undefined,
  );

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({ persistent: false, issuedAt: new Date(), expiresAt: new Date() });
  vi.mocked(loadProfile).mockResolvedValue(demoProfile());
  vi.mocked(loadSettings).mockResolvedValue(settingsFromRows([]));
  vi.mocked(prisma.application.count).mockReset().mockResolvedValue(0);
});

describe("GET /api/docx", () => {
  it("downloads the base resume as a Word file named like the PDF", async () => {
    const response = await get("?doc=base");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(DOCX);
    expect(response.headers.get("content-disposition")).toContain(".docx");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
  });

  it("says when there's no such document or application", async () => {
    expect((await get("?doc=photo")).status).toBe(404);
    const missing = await get("?doc=resume&application=abc123");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "That application no longer exists." });
  });
});

describe("POST /api/docx", () => {
  it("holds the file and answers with the link to download it from", async () => {
    const response = await post("?doc=base");
    const { url } = (await response.json()) as { url: string };
    expect(url).toMatch(/^\/api\/docx\/[0-9a-f-]+$/);
    const id = url.split("/").at(-1)!;
    const held = await GET_HELD(new NextRequest(`http://localhost:3000${url}`), { params: Promise.resolve({ id }) });
    expect(held.headers.get("content-type")).toBe(DOCX);
    // A PDF's link doesn't hand over a Word file, nor the other way round.
    expect((await GET_HELD(new NextRequest("http://localhost:3000/api/docx/nope"), { params: Promise.resolve({ id: "nope" }) })).status).toBe(404);
  });
});
