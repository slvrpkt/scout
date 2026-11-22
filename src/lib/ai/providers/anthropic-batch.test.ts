import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordCost } from "@/lib/costs";

import { inBatchWindow } from "../batch-window";

import { AnthropicProvider } from "./anthropic";

// A fake Messages API: what a direct request and a batch of one answer.
const api = vi.hoisted(() => ({
  create: vi.fn(),
  batchCreate: vi.fn(),
  retrieve: vi.fn(),
  results: vi.fn(),
  cancel: vi.fn(async () => ({})),
}));
vi.mock("@anthropic-ai/sdk", () => {
  class BadRequestError extends Error {}
  class Anthropic {
    static BadRequestError = BadRequestError;
    messages = { create: api.create, batches: { create: api.batchCreate, retrieve: api.retrieve, results: api.results, cancel: api.cancel } };
    models = { retrieve: vi.fn(async () => ({ capabilities: {} })) };
  }
  return { default: Anthropic };
});
vi.mock("@/lib/costs", () => ({ recordCost: vi.fn(async () => {}), limitReached: vi.fn(async () => null) }));
vi.mock("@/lib/jobs/runner", () => ({ waitOutsideLimit: (work: Promise<unknown>) => work }));

const usage = { input_tokens: 1_000_000, output_tokens: 0 };
const message = (text: string) => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage, model: "claude-haiku-4-5" });
const provider = () => new AnthropicProvider("https://api.anthropic.com", "sk-test", "claude-haiku-4-5", 60_000);
const ask = () => provider().complete({ system: "Answer.", messages: [{ role: "user", content: "Hello?" }] });

beforeEach(() => {
  vi.clearAllMocks();
  api.create.mockResolvedValue(message("direct"));
  api.batchCreate.mockResolvedValue({ id: "batch-1" });
  api.retrieve.mockResolvedValue({ processing_status: "ended" });
  api.results.mockResolvedValue((async function* () {
    yield { custom_id: "step", result: { type: "succeeded", message: message("batched") } };
  })());
});

describe("batched calls (cheaper drafts)", () => {
  it("send a call in a batch window as a batch of one, at half price", async () => {
    expect(await inBatchWindow(ask, 1_000)).toBe("batched");
    expect(api.batchCreate).toHaveBeenCalledWith({ requests: [expect.objectContaining({ custom_id: "step" })] }, expect.anything());
    expect(api.create).not.toHaveBeenCalled();
    // A million input tokens at $1, halved.
    expect(recordCost).toHaveBeenCalledWith("ANTHROPIC", "other", 0.5);
  });

  it("go at the normal price once a batch takes too long, and so does the rest of that work", async () => {
    api.retrieve.mockResolvedValue({ processing_status: "in_progress" });
    const answers = await inBatchWindow(async () => [await ask(), await ask()], 30);
    expect(answers).toEqual(["direct", "direct"]);
    expect(api.cancel).toHaveBeenCalledWith("batch-1");
    // The second call didn't try a batch: the window had closed.
    expect(api.batchCreate).toHaveBeenCalledTimes(1);
  });

  it("go at the normal price outside a batch window, or when a batch can't be made", async () => {
    expect(await ask()).toBe("direct");
    expect(api.batchCreate).not.toHaveBeenCalled();
    api.batchCreate.mockRejectedValueOnce(new Error("overloaded"));
    expect(await inBatchWindow(ask, 1_000)).toBe("direct");
  });
});
