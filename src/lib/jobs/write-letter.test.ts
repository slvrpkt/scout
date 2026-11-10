import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ running: 0, ai: true }));
vi.mock("@/lib/ai/config", () => ({ isAiUsable: async () => state.ai }));
vi.mock("./runner", () => ({
  defineJob: (definition: unknown) => definition,
  findUnfinishedJobs: async () => Array.from({ length: state.running }, (_, index) => ({ id: `running-${index}` })),
  startJob: vi.fn(async () => "job-1"),
}));

import { letterPending, queueLetter } from "./write-letter";
import { startJob } from "./runner";

beforeEach(() => {
  state.running = 0;
  state.ai = true;
  vi.mocked(startJob).mockClear();
});

describe("the cover letter, written when a job agent draft is opened", () => {
  it("is pending while the letter has only its frame", () => {
    expect(letterPending([{ id: "sender" }, { id: "greeting" }, { id: "signature" }])).toBe(true);
    expect(letterPending([{ id: "greeting" }, { id: "paragraph:1" }])).toBe(false);
  });

  it("starts once, and follows the one under way", async () => {
    expect(await queueLetter("app-1")).toBe("job-1");
    expect(startJob).toHaveBeenCalledWith(expect.objectContaining({ type: "write-letter" }), { applicationId: "app-1" }, { key: "write-letter:app-1" });
    state.running = 1;
    expect(await queueLetter("app-1")).toBe("running-0");
    expect(startJob).toHaveBeenCalledTimes(1);
  });

  it("waits without an AI model", async () => {
    state.ai = false;
    expect(await queueLetter("app-1")).toBeNull();
  });
});
