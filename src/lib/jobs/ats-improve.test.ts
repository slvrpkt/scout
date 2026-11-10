import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ on: true, running: 0 }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: async () => ({ atsOptimize: state.on }) }));
vi.mock("@/lib/ai/config", () => ({ isAiUsable: async () => true }));
vi.mock("./runner", () => ({
  defineJob: (definition: unknown) => definition,
  findUnfinishedJobs: async () => Array.from({ length: state.running }, (_, index) => ({ id: `j${index}` })),
  startJob: vi.fn(async () => "job-1"),
}));

import { queueAtsImprove } from "./ats-improve";
import { startJob } from "./runner";

beforeEach(() => {
  state.on = true;
  state.running = 0;
  vi.mocked(startJob).mockClear();
});

describe("improving every new draft for the ATS", () => {
  it("starts in the background for a new draft", async () => {
    await queueAtsImprove("app-1");
    expect(startJob).toHaveBeenCalledWith(expect.objectContaining({ type: "ats-improve" }), { applicationId: "app-1" }, { key: "ats-improve:app-1" });
  });

  it("doesn't when ATS optimization is off, or one is already under way", async () => {
    state.on = false;
    await queueAtsImprove("app-1");
    state.on = true;
    state.running = 1;
    await queueAtsImprove("app-1");
    expect(startJob).not.toHaveBeenCalled();
  });
});
