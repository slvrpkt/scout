import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LIVE_CHECK_MS, useLivePage } from "./use-live-page";

const router = { refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => {
  vi.useFakeTimers();
  router.refresh.mockClear();
});
afterEach(() => vi.useRealTimers());

const tick = () => act(async () => void (await vi.advanceTimersByTimeAsync(LIVE_CHECK_MS)));

describe("useLivePage", () => {
  it("leaves the page alone while nothing changed elsewhere", async () => {
    const check = vi.fn(async () => "a");
    renderHook(() => useLivePage("a", check, false));
    await tick();
    expect(check).toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("redraws by itself when it changed elsewhere, and says so", async () => {
    const { result } = renderHook(() => useLivePage("a", async () => "b", false));
    await tick();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(result.current.updated).toBe(true);
  });

  it("waits for Refresh while you're editing, then redraws once you're done", async () => {
    const { result, rerender } = renderHook(({ busy }) => useLivePage("a", async () => "b", busy), { initialProps: { busy: true } });
    await tick();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(result.current.changed).toBe(true);
    rerender({ busy: false });
    expect(router.refresh).toHaveBeenCalled();
  });
});
