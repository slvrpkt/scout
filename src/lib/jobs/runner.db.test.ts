import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AiError } from "@/lib/ai/errors";
import { createTestClient, resetDatabase } from "@/test/db";

import { cancelApplicationJobs, cancelJob, defineJob, getJob, recoverInterruptedJobs, retryJob, startJob, subscribeJob, waitOutsideLimit } from "./runner";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const ai = vi.hoisted(() => ({ provider: "LOCAL" }));
vi.mock("@/lib/ai/config", () => ({ loadAiConfig: async () => ({ provider: ai.provider }) }));
vi.spyOn(console, "error").mockImplementation(() => {});

const prisma = () => db.client!;

/** Waits until `check` passes, for work that runs in the background. */
async function eventually(check: () => Promise<void>, timeout = 3000) {
  const started = Date.now();
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() - started > timeout) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}
const status = async (id: string) => expect((await getJob(id))?.status);

// A job whose run waits until the test lets it go.
const gates = new Map<string, () => void>();
const gated = defineJob({
  type: "test-gated",
  input: z.object({ name: z.string(), fail: z.enum(["no", "error", "ai"]).default("no") }),
  result: z.object({ greeting: z.string() }),
  async run({ name, fail }, { step, signal }) {
    await step("Waiting");
    await new Promise<void>((resolve, reject) => {
      // Cancelled while reporting its step: the abort event has already fired.
      if (signal.aborted) return reject(signal.reason);
      gates.set(name, resolve);
      signal.addEventListener("abort", () => reject(signal.reason));
    });
    await step("Greeting");
    if (fail === "error") throw new Error("database exploded: secret details");
    if (fail === "ai") throw AiError.of("unreachable");
    return { greeting: `Hello, ${name}` };
  },
});
const release = (name: string) => eventually(async () => {
  const open = gates.get(name);
  expect(open).toBeDefined();
  gates.delete(name);
  open!();
});

beforeEach(async () => {
  await resetDatabase(prisma());
  ai.provider = "LOCAL";
});
afterAll(() => prisma().$disconnect());

describe("the job runner", () => {
  it("runs a job in the background with named steps and keeps its result (E6-7)", async () => {
    const seen: string[] = [];
    const id = await startJob(gated, { name: "Jane", fail: "no" }, { key: "application:1" });
    const stop = subscribeJob(id, (job) => seen.push(`${job.status}${job.step ? ` · ${job.step}` : ""}`));
    await eventually(async () => (await status(id)).toBe("RUNNING"));
    await release("Jane");
    await eventually(async () => (await status(id)).toBe("DONE"));
    stop();
    expect(await getJob(id)).toMatchObject({ step: "Greeting", error: null, result: { greeting: "Hello, Jane" } });
    expect(seen).toContain("RUNNING · Waiting");
    expect(seen.at(-1)).toBe("DONE · Greeting");
    const row = await prisma().job.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ type: "test-gated", key: "application:1", input: { name: "Jane", fail: "no" } });
    expect(row.startedAt).not.toBeNull();
    expect(row.finishedAt).not.toBeNull();
  });

  it("keeps AI errors' plain words and hides everything else", async () => {
    const ai = await startJob(gated, { name: "Ai", fail: "ai" });
    const other = await startJob(gated, { name: "Other", fail: "error" });
    await release("Ai");
    await eventually(async () => (await status(ai)).toBe("FAILED"));
    await release("Other");
    await eventually(async () => (await status(other)).toBe("FAILED"));
    expect((await getJob(ai))?.error).toBe("Couldn't reach the server. Check the address and that it's running.");
    expect((await getJob(other))?.error).toBe("Something went wrong while working on this. Try again.");
  });

  it("retries a failed job as the same job, without a duplicate", async () => {
    const id = await startJob(gated, { name: "Retry", fail: "ai" });
    await release("Retry");
    await eventually(async () => (await status(id)).toBe("FAILED"));
    expect(await retryJob(id)).toBe(true);
    await eventually(async () => (await status(id)).toBe("RUNNING"));
    expect(await retryJob(id)).toBe(false);
    await release("Retry");
    await eventually(async () => (await status(id)).toBe("FAILED"));
    expect(await prisma().job.count()).toBe(1);
  });

  it("runs one job at a time for a local model, more for hosted ones", async () => {
    const first = await startJob(gated, { name: "First", fail: "no" });
    const second = await startJob(gated, { name: "Second", fail: "no" });
    await eventually(async () => (await status(first)).toBe("RUNNING"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    (await status(second)).toBe("QUEUED");
    await release("First");
    await eventually(async () => (await status(second)).toBe("RUNNING"));
    await release("Second");
    await eventually(async () => (await status(second)).toBe("DONE"));

    ai.provider = "ANTHROPIC";
    const a = await startJob(gated, { name: "A", fail: "no" });
    const b = await startJob(gated, { name: "B", fail: "no" });
    await eventually(async () => {
      (await status(a)).toBe("RUNNING");
      (await status(b)).toBe("RUNNING");
    });
    await release("A");
    await release("B");
    await eventually(async () => (await status(b)).toBe("DONE"));
  });

  it("cancels an application's unfinished jobs, and only those", async () => {
    await prisma().application.createMany({ data: [{ id: "app-1" }, { id: "app-2" }] });
    const running = await startJob(gated, { name: "Mine", fail: "no" }, { applicationId: "app-1" });
    const queued = await startJob(gated, { name: "Mine too", fail: "no" }, { applicationId: "app-1" });
    const other = await startJob(gated, { name: "Theirs", fail: "no" }, { applicationId: "app-2" });
    await eventually(async () => (await status(running)).toBe("RUNNING"));
    await cancelApplicationJobs("app-1");
    await eventually(async () => {
      expect(await getJob(running)).toMatchObject({ status: "FAILED", error: "Cancelled." });
      expect(await getJob(queued)).toMatchObject({ status: "FAILED", error: "Cancelled." });
    });
    expect(await prisma().job.findUniqueOrThrow({ where: { id: other } })).toMatchObject({ applicationId: "app-2" });
    await eventually(async () => (await status(other)).toBe("RUNNING"));
    await release("Theirs");
    await eventually(async () => (await status(other)).toBe("DONE"));
  });

  it("ends a job deleted while it runs without an error", async () => {
    const id = await startJob(gated, { name: "Deleted", fail: "no" });
    await eventually(async () => (await status(id)).toBe("RUNNING"));
    vi.mocked(console.error).mockClear();
    await prisma().job.delete({ where: { id } });
    await release("Deleted");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(console.error).not.toHaveBeenCalled();
  });

  it("cancels a running or a queued job", async () => {
    const running = await startJob(gated, { name: "Running", fail: "no" });
    const queued = await startJob(gated, { name: "Queued", fail: "no" });
    await eventually(async () => (await status(running)).toBe("RUNNING"));
    await cancelJob(queued);
    await cancelJob(running);
    await eventually(async () => {
      expect(await getJob(running)).toMatchObject({ status: "FAILED", error: "Cancelled." });
      expect(await getJob(queued)).toMatchObject({ status: "FAILED", error: "Cancelled." });
    });
  });

  it("lets another job run while one waits on something slow, such as a batch", async () => {
    // One job at a time with a local model.
    let letGo = () => {};
    const waiter = defineJob({
      type: "test-waiter",
      input: z.object({}),
      result: z.object({}),
      run: async () => {
        await waitOutsideLimit(new Promise<void>((resolve) => (letGo = resolve)));
        return {};
      },
    });
    const quick = defineJob({ type: "test-quick", input: z.object({}), result: z.object({}), run: async () => ({}) });
    const waiting = await startJob(waiter, {});
    await eventually(async () => (await status(waiting)).toBe("RUNNING"));
    const other = await startJob(quick, {});
    await eventually(async () => (await status(other)).toBe("DONE"));
    letGo();
    await eventually(async () => (await status(waiting)).toBe("DONE"));
  });

  it("starts jobs a previous process left unfinished again on their own, and gives up on one cut off three times in a row", async () => {
    defineJob({ type: "test-own-recovery", input: z.object({}), result: z.object({}), run: async () => ({}), resumable: false });
    await prisma().job.createMany({
      data: [
        { id: "own", type: "test-own-recovery", status: "RUNNING", input: {} },
        { id: "running", type: "test-gated", status: "RUNNING", step: "Greeting", input: { name: "a" }, createdAt: new Date(1000) },
        { id: "queued", type: "test-gated", status: "QUEUED", input: { name: "b" }, createdAt: new Date(2000) },
        { id: "again", type: "test-gated", status: "RUNNING", input: { name: "c" }, resumes: 2 },
        { id: "done", type: "test-gated", status: "DONE", input: { name: "d" } },
      ],
    });
    expect(await recoverInterruptedJobs()).toEqual({ resumed: 2, failed: 2 });
    // Its module picks up the pieces.
    expect(await getJob("own")).toMatchObject({ status: "FAILED", error: "Scout restarted before this finished. Try again." });
    // Oldest first, from the beginning.
    await release("a");
    await release("b");
    await eventually(async () => {
      expect(await getJob("running")).toMatchObject({ status: "DONE", result: { greeting: "Hello, a" } });
      expect(await getJob("queued")).toMatchObject({ status: "DONE", result: { greeting: "Hello, b" } });
    });
    expect(await prisma().job.findUnique({ where: { id: "running" } })).toMatchObject({ resumes: 1 });
    expect(await getJob("again")).toMatchObject({ status: "FAILED", error: "Scout restarted before this could finish, three times in a row. Try again." });
    // Retry by hand starts the count over.
    await retryJob("again");
    expect(await prisma().job.findUnique({ where: { id: "again" } })).toMatchObject({ resumes: 0 });
    await release("c");
    await eventually(async () => (await status("again")).toBe("DONE"));
  });
});
