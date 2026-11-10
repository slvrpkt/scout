import { afterEach, describe, expect, it, vi } from "vitest";

// Scout has no telemetry server of its own: with none set up, nothing is asked or sent, even in production.
describe("the usage ping without a telemetry server", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is never asked about and never sent", async () => {
    vi.stubEnv("SCOUT_TELEMETRY_HOST", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { askForUsagePing, usagePingEnabled, USAGE_PING_URL } = await import("./usage-ping");
    expect(USAGE_PING_URL).toBe("");
    expect(askForUsagePing({ usagePingChoice: null, usagePingChoiceText: null } as never)).toBe(false);
    expect(usagePingEnabled({ usagePingChoice: "on", usagePingChoiceText: 1 } as never)).toBe(false);
  });
});
