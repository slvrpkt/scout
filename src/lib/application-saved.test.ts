import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentCandidate: { findUnique: vi.fn() },
    posting: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    application: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/postings", () => ({ storePosting: vi.fn(), unmarkPosting: vi.fn() }));
vi.mock("@/lib/agent/draft", () => ({ foundFromCandidate: vi.fn((candidate: { externalId: string }) => ({ externalId: candidate.externalId })) }));

import { prisma } from "@/lib/prisma";
import { storePosting, unmarkPosting } from "@/lib/postings";

import { applicationSaved, saveApplicationJob } from "./application-saved";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.agentCandidate.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.posting.findUnique).mockResolvedValue(null);
});

describe("Save for later from an application", () => {
  it("saves and unsaves a job agent find as its card does", async () => {
    vi.mocked(prisma.agentCandidate.findUnique).mockResolvedValue({ source: "JSEARCH", externalId: "j1" } as never);
    expect(await saveApplicationJob("app1", true)).toBe(true);
    expect(storePosting).toHaveBeenCalledWith({ externalId: "j1" }, expect.objectContaining({ savedAt: expect.any(Date), dismissedAt: null }));
    await saveApplicationJob("app1", false);
    expect(unmarkPosting).toHaveBeenCalledWith({ source: "JSEARCH", externalId: "j1" }, "saved");
  });

  it("marks the stored posting of a manual or pasted application, keeping it either way", async () => {
    vi.mocked(prisma.posting.findUnique).mockResolvedValue({ id: "p1" } as never);
    await saveApplicationJob("app1", false);
    expect(prisma.posting.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { savedAt: null } });
    expect(prisma.posting.create).not.toHaveBeenCalled();
  });

  it("keeps an older pasted application's job when it's first saved", async () => {
    vi.mocked(prisma.application.findUnique).mockResolvedValue({
      id: "app1",
      role: "PM",
      title: "PM · Acme",
      company: "Acme",
      location: "Remote",
      salary: "",
      postingUrl: "javascript:alert(1)",
      postingText: "The job",
    } as never);
    expect(await saveApplicationJob("app1", true)).toBe(true);
    expect(prisma.posting.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ externalId: "pasted:app1", pasted: true, applicationId: "app1", url: "", savedAt: expect.any(Date) }),
    });
  });

  it("says whether it's saved", async () => {
    expect(await applicationSaved("app1")).toBe(false);
    vi.mocked(prisma.posting.findUnique).mockResolvedValue({ savedAt: new Date() } as never);
    expect(await applicationSaved("app1")).toBe(true);
  });
});
