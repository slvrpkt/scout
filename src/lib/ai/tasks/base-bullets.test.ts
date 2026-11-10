import { describe, expect, it, vi } from "vitest";

import { demoProfile } from "@/lib/demo-profile";

import { writeBaseBullets } from "./base-bullets";
import { scoringProfile, SCORING_POINTS } from "./score-posting";

const options = { creativity: "BALANCED", strict: true, language: null } as never;
const points = (count: number) => Array.from({ length: count }, (_, index) => `Point ${index + 1}`).join("\n");
const profile = { ...demoProfile(), experience: demoProfile().experience.map((role, index) => ({ ...role, bullets: points(index === 0 ? 12 : 4) })) };
const model = (answer: (request: { system: string; messages: { content: string }[] }) => unknown) => {
  const complete = vi.fn(async (request: never) => answer(request));
  return { provider: { kind: "MOCK", model: "m", complete } as never, complete };
};

describe("writeBaseBullets", () => {
  it("chooses each role's strongest points within its budget for two pages, for the candidate's title", async () => {
    const newest = profile.experience.toSorted((a, b) => (b.current ? 1 : 0) - (a.current ? 1 : 0))[0];
    const { provider, complete } = model(() => ({ roles: [{ id: profile.experience[0].id, bullets: Array.from({ length: 11 }, (_, index) => `Chosen ${index + 1}`) }] }));
    const { data } = await writeBaseBullets(provider, { profile, title: "Technical Project Manager", maxPages: 2 }, options);
    const request = complete.mock.calls[0][0] as { system: string; messages: { content: string }[] };
    expect(request.system).toMatch(/2-page resume/);
    expect(request.system).toMatch(/as a Technical Project Manager/);
    // Outcome-driven: scope, ownership and results, never invented.
    expect(request.system).toContain("Results over duties");
    expect(request.system).toContain("Never invent or infer a number");
    expect(request.messages[0].content).toMatch(/chosen from its 12 points/);
    // Kept to the budget, at most 8 for the most recent role.
    expect(data[profile.experience[0].id].length).toBeLessThanOrEqual(8);
    // A role the answer left out keeps what was written, within its budget.
    const other = profile.experience.find((role) => role.id !== profile.experience[0].id)!;
    expect(data[other.id][0]).toBe("Point 1");
    expect(newest).toBeDefined();
  });

  it("polishes every point for Full, and keeps what was written when the answer drops any", async () => {
    const id = profile.experience[0].id;
    const { provider, complete } = model(() => ({ roles: [{ id, bullets: ["Only one"] }] }));
    const { data } = await writeBaseBullets(provider, { profile, title: "", maxPages: null }, options);
    const request = complete.mock.calls[0][0] as { system: string };
    expect(request.system).toContain("Keep the experience complete");
    expect(data[id]).toHaveLength(12);
    expect(data[id][0]).toBe("Point 1");
  });
});

describe("scoringProfile", () => {
  it("keeps only each role's first points, so scoring costs the same however long the profile grows", () => {
    const short = scoringProfile(profile);
    expect(short.experience[0].bullets.split("\n")).toHaveLength(SCORING_POINTS.role);
    expect(short.basics).toEqual(profile.basics);
  });
});
