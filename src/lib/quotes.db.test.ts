import { afterAll, describe, expect, it, vi } from "vitest";

import { createTestClient } from "@/test/db";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});

import { QUOTE_BANK } from "./quote-bank";
import { randomQuote } from "./quotes";

afterAll(async () => db.client!.$disconnect());

describe("the dashboard's encouraging lines", () => {
  it("has a hundred different lines", () => {
    expect(QUOTE_BANK).toHaveLength(100);
    expect(new Set(QUOTE_BANK).size).toBe(100);
  });

  it("picks one of them at random", async () => {
    await db.client!.quote.deleteMany();
    await db.client!.quote.createMany({ data: QUOTE_BANK.slice(0, 3).map((text) => ({ text })) });
    expect(QUOTE_BANK.slice(0, 3)).toContain(await randomQuote());
    await db.client!.quote.deleteMany();
    expect(await randomQuote()).toBeNull();
  });
});
