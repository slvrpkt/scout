import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

// Work that can wait a little for half the price: the AI calls made inside a
// batch window go out as batches where the provider has them (Anthropic), and
// each may wait up to `stepMs` for its answer. One that takes longer closes
// the window, so the rest of that work is sent at the normal price and is
// done in good time. The job agent's automatic drafts run in one.

export type BatchWindow = {
  /** How long one call may wait for its batch. */
  stepMs: number;
  /** A call waited too long: the rest go at the normal price. */
  expired: boolean;
};

/** How long a step of an automatic draft may wait for its batch. */
export const DRAFT_STEP_WAIT_MS = 20 * 60 * 1000;

const store = new AsyncLocalStorage<BatchWindow>();

/** Runs `work` with its AI calls batched, each waiting at most `stepMs`. */
export function inBatchWindow<T>(work: () => Promise<T>, stepMs = DRAFT_STEP_WAIT_MS): Promise<T> {
  return store.run({ stepMs, expired: false }, work);
}

/** The batch window the current work runs in, while it's still open. */
export function openBatchWindow(): BatchWindow | null {
  const window = store.getStore();
  return window && !window.expired ? window : null;
}
