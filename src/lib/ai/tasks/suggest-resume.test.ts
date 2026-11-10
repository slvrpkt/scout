import { describe, expect, it, vi } from "vitest";

import { demoProfile } from "@/lib/demo-profile";

import { writeBaseSummary } from "./base-summary";
import { suggestResume } from "./suggest-resume";

const options = { creativity: "BALANCED", strict: true, language: null } as const;
const model = (answer: unknown) => ({ kind: "MOCK", model: "m", complete: vi.fn(async () => answer) }) as never;

describe("suggestResume", () => {
  it("keeps five short ideas at most", async () => {
    const { data } = await suggestResume(model({ suggestions: [" One ", "", "Two", "3", "4", "5", "6"] }), { profile: demoProfile(), extracted: { requirements: [] } as never, units: [] }, options);
    expect(data).toEqual(["One", "Two", "3", "4", "5"]);
  });
});

describe("writeBaseSummary", () => {
  it("returns the summary", async () => {
    expect((await writeBaseSummary(model({ summary: " Short. " }), { profile: demoProfile() }, options)).data).toBe("Short.");
  });
});
