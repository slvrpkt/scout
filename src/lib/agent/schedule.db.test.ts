import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentRun } from "@/lib/settings";
import { saveSettings } from "@/lib/settings-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { nextAgentRun, resetInterruptedDrafts, scheduledRunDue, startDueRun } from "./schedule";
import { runLimitProblem } from "./runs";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const zone = vi.hoisted(() => ({ value: "Europe/Berlin" }));
vi.mock("@/lib/time-zone", () => ({ lastKnownTimeZone: async () => zone.value }));
vi.mock("@/lib/jobs/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/runner")>()),
  startJob: vi.fn(async () => "agent-job"),
}));

const prisma = () => db.client!;
const run = (at: string, manual = false): AgentRun => ({ at, manual, message: null });

beforeEach(async () => {
  zone.value = "Europe/Berlin";
  await resetDatabase(prisma());
});
afterAll(() => prisma().$disconnect());

describe("switching the agent on (after a time today has gone by)", () => {
  const times = ["08:30", "13:00"];
  const now = new Date("2026-11-11T03:30:00.000Z"); // 10:30 PM in New York
  const onSince = "2026-11-11T03:29:00.000Z";

  it("doesn't catch up a time from before it was switched on", () => {
    expect(scheduledRunDue(now, times, "America/New_York", [], onSince)).toBe(false);
    expect(nextAgentRun(now, times, "America/New_York", [], onSince).toISOString()).toBe("2026-11-11T13:30:00.000Z");
  });

  it("still catches up a time missed while the app was off, once it was on", () => {
    // On since the evening before; the app was off at 8:30 AM and is back at 9:00.
    expect(scheduledRunDue(new Date("2026-11-11T14:00:00.000Z"), times, "America/New_York", [], onSince)).toBe(true);
  });

  it("catches up as before when it isn't known when it was switched on", () => {
    expect(scheduledRunDue(now, times, "America/New_York", [], null)).toBe(true);
  });
});

describe("runs that failed or were cut short", () => {
  const now = new Date("2026-11-06T14:00:00.000Z");
  const failed = (minutes: number) => ({ at: new Date(now.getTime() - minutes * 60_000).toISOString(), manual: false, message: "No", failed: true });

  it("are tried again, up to three tries at one run time, and a good run ends it", () => {
    expect(scheduledRunDue(now, ["13:00"], "UTC", [failed(30)])).toBe(true);
    expect(scheduledRunDue(now, ["13:00"], "UTC", [failed(15), failed(30)])).toBe(true);
    expect(scheduledRunDue(now, ["13:00"], "UTC", [failed(5), failed(15), failed(30)])).toBe(false);
    expect(scheduledRunDue(now, ["13:00"], "UTC", [{ ...failed(10), failed: false }, failed(30)])).toBe(false);
  });
});

describe("when the daily run is due (E16-4)", () => {
  it("reads the hour and the day in the user's time zone, not the server's", () => {
    // 05:30 UTC is 07:30 in Berlin: due at 7 there, though UTC hasn't reached 7.
    expect(scheduledRunDue(new Date("2026-10-20T05:30:00Z"), ["07:00"], "Europe/Berlin", [])).toBe(true);
    expect(scheduledRunDue(new Date("2026-10-20T04:30:00Z"), ["07:00"], "Europe/Berlin", [])).toBe(false);
    expect(scheduledRunDue(new Date("2026-10-20T05:30:00Z"), ["07:00"], "UTC", [])).toBe(false);
    // Kolkata is UTC+5:30, with no daylight saving.
    expect(scheduledRunDue(new Date("2026-10-20T01:30:00Z"), ["07:00"], "Asia/Kolkata", [])).toBe(true);
    expect(scheduledRunDue(new Date("2026-10-20T01:29:00Z"), ["07:00"], "Asia/Kolkata", [])).toBe(false);
  });

  it("runs once per time: a run since that time, scheduled or not, counts; one before it doesn't", () => {
    // 05:30 UTC is 07:30 in Berlin, after the 07:00 run time.
    expect(scheduledRunDue(new Date("2026-10-20T06:00:00Z"), ["07:00"], "Europe/Berlin", [run("2026-10-20T05:30:00Z", true)])).toBe(false);
    // 23:30 UTC on the 19th is 01:30 on the 20th in Berlin: before 07:00, so 07:00 still runs.
    expect(scheduledRunDue(new Date("2026-10-20T06:00:00Z"), ["07:00"], "Europe/Berlin", [run("2026-10-19T23:30:00Z", true)])).toBe(true);
    expect(scheduledRunDue(new Date("2026-10-20T07:00:00Z"), ["07:00"], "UTC", [run("2026-10-19T23:30:00Z", true)])).toBe(true);
  });

  it("runs at each of several times, and makes one run of times it missed", () => {
    const times = ["04:00", "08:00", "13:00"];
    // UTC, so the times read as they are. 04:10: the 04:00 run is due.
    expect(scheduledRunDue(new Date("2026-10-20T04:10:00Z"), times, "UTC", [])).toBe(true);
    expect(scheduledRunDue(new Date("2026-10-20T04:10:00Z"), times, "UTC", [run("2026-10-20T04:00:00Z")])).toBe(false);
    // 08:00 comes round: due again, though 04:00 ran.
    expect(scheduledRunDue(new Date("2026-10-20T08:00:00Z"), times, "UTC", [run("2026-10-20T04:00:00Z")])).toBe(true);
    // Off all morning: at 13:30, 04:00, 08:00 and 13:00 make one run, then nothing until tomorrow.
    expect(scheduledRunDue(new Date("2026-10-20T13:30:00Z"), times, "UTC", [])).toBe(true);
    expect(scheduledRunDue(new Date("2026-10-20T13:45:00Z"), times, "UTC", [run("2026-10-20T13:30:00Z")])).toBe(false);
    expect(nextAgentRun(new Date("2026-10-20T13:45:00Z"), times, "UTC", [run("2026-10-20T13:30:00Z")]).toISOString()).toBe("2026-10-21T04:00:00.000Z");
    // Before the first time of the day, nothing is due, and the next is today's first.
    expect(scheduledRunDue(new Date("2026-10-20T03:59:00Z"), times, "UTC", [])).toBe(false);
    expect(nextAgentRun(new Date("2026-10-20T03:00:00Z"), times, "UTC", []).toISOString()).toBe("2026-10-20T04:00:00.000Z");
    expect(nextAgentRun(new Date("2026-10-20T05:00:00Z"), times, "UTC", [run("2026-10-20T04:00:00Z")]).toISOString()).toBe("2026-10-20T08:00:00.000Z");
  });

  it("allows a couple more runs than run times in any 24 hours", () => {
    const now = new Date("2026-10-20T14:00:00Z");
    const five = ["13:00", "12:00", "08:00", "06:00", "04:00"].map((time) => run(`2026-10-20T${time}:00Z`));
    expect(runLimitProblem(five.slice(1), now, { manual: false, times: ["04:00", "08:00", "13:00"] })).toBeNull();
    expect(runLimitProblem(five, now, { manual: false, times: ["04:00", "08:00", "13:00"] })).toMatch(/^The agent has run 5 times in the past 24 hours/);
  });

  it("keeps the hour across daylight saving changes", () => {
    // Berlin leaves summer time on 25 October 2026: 07:00 is 05:00 UTC the day before, 06:00 UTC that day.
    const ranSaturday = [run("2026-10-24T05:00:00Z")];
    expect(nextAgentRun(new Date("2026-10-24T09:00:00Z"), ["07:00"], "Europe/Berlin", ranSaturday).toISOString()).toBe("2026-10-25T06:00:00.000Z");
    // New York leaves it on 1 November 2026.
    const ranOn31st = [run("2026-10-31T11:00:00Z")];
    expect(nextAgentRun(new Date("2026-10-31T15:00:00Z"), ["07:00"], "America/New_York", ranOn31st).toISOString()).toBe("2026-11-01T12:00:00.000Z");
    // And Berlin goes back to summer time on 28 March 2027.
    expect(nextAgentRun(new Date("2027-03-27T10:00:00Z"), ["07:00"], "Europe/Berlin", [run("2027-03-27T06:00:00Z")]).toISOString()).toBe("2027-03-28T05:00:00.000Z");
  });

  it("says the next run is today's while it's still to come, and soon when it's overdue", () => {
    expect(nextAgentRun(new Date("2026-10-20T03:00:00Z"), ["07:00"], "Europe/Berlin", []).toISOString()).toBe("2026-10-20T05:00:00.000Z");
    expect(nextAgentRun(new Date("2026-10-20T05:07:00Z"), ["07:00"], "Europe/Berlin", []).toISOString()).toBe("2026-10-20T05:15:00.000Z");
  });
});

describe("the limits (E16-4)", () => {
  const now = new Date("2026-10-20T12:00:00Z");

  it("lets Run now go an hour after the previous run of either kind", () => {
    expect(runLimitProblem([], now, { manual: true, times: ["07:00"] })).toBeNull();
    expect(runLimitProblem([run("2026-10-20T11:35:00Z")], now, { manual: true, times: ["07:00"] })).toBe("The agent ran less than an hour ago. Try again in 35 minutes.");
    expect(runLimitProblem([run("2026-10-20T10:59:00Z", true)], now, { manual: true, times: ["07:00"] })).toBeNull();
    // A scheduled run only minds the daily limit.
    expect(runLimitProblem([run("2026-10-20T11:35:00Z")], now, { manual: false, times: ["07:00"] })).toBeNull();
  });

  it("allows 3 runs in any 24 hours", () => {
    const three = [run("2026-10-20T11:00:00Z"), run("2026-10-20T08:00:00Z"), run("2026-10-19T13:00:00Z")];
    expect(runLimitProblem(three, now, { manual: false, times: ["07:00"] })).toBe("The agent has run 3 times in the past 24 hours, as many as it may. Try again in 1 hour.");
    expect(runLimitProblem(three, new Date("2026-10-20T13:00:01Z"), { manual: false, times: ["07:00"] })).toBeNull();
    expect(runLimitProblem(three.slice(0, 2), now, { manual: false, times: ["07:00"] })).toBeNull();
  });
});

describe("the schedule (E16-4)", () => {
  it("starts the day's run when it's due and the agent is on, once", async () => {
    const { startJob } = await import("@/lib/jobs/runner");
    const due = new Date("2026-10-20T06:00:00Z");
    expect(await startDueRun(due)).toBeNull();
    await saveSettings({ agentEnabled: true, agentTimes: ["07:00"] });
    expect(await startDueRun(due)).toBe("agent-job");
    expect(startJob).toHaveBeenCalledWith(expect.objectContaining({ type: "agent-scan" }), { manual: false }, { key: "agent" });

    // Not while one is queued or running, nor before the hour, nor after today's.
    vi.mocked(startJob).mockClear();
    await prisma().job.create({ data: { type: "agent-scan", key: "agent", status: "RUNNING", input: { manual: false } } });
    expect(await startDueRun(due)).toBeNull();
    await prisma().job.deleteMany();
    expect(await startDueRun(new Date("2026-10-20T04:00:00Z"))).toBeNull();
    await saveSettings({ agentRuns: [run("2026-10-20T05:00:00Z")] });
    expect(await startDueRun(due)).toBeNull();
    expect(startJob).not.toHaveBeenCalled();
  });

  it("sends drafts a restart interrupted back to the queue, saying so", async () => {
    await prisma().agentCandidate.create({ data: { source: "JSEARCH", externalId: "job-1", dedupeKey: "k1", status: "DRAFTING" } });
    await prisma().agentCandidate.create({ data: { source: "JSEARCH", externalId: "job-2", dedupeKey: "k2", status: "DRAFTED" } });
    expect(await resetInterruptedDrafts()).toBe(1);
    expect(await prisma().agentCandidate.findMany({ orderBy: { externalId: "asc" }, select: { status: true, error: true } })).toEqual([
      { status: "SCORED", error: "Drafting was interrupted. Try again." },
      { status: "DRAFTED", error: null },
    ]);
  });
});
