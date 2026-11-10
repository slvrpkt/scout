import { describe, expect, it } from "vitest";

import { MockProvider } from "@/lib/ai/providers/mock";

import { checkVersions, condenseBullets, roomProblem } from "./condense-bullets";

const options = { creativity: "BALANCED" as const, strict: true, language: null };
const bullets = [
  "Led a team of 6 engineers building the checkout",
  "Cut page load time by 40%",
  "Moved billing to Stripe",
  "Ran weekly design reviews",
  "Mentored 3 juniors",
];
const input = { role: "Engineering Lead", company: "Ledgerly", bullets, counts: [4, 2] };

describe("checkVersions", () => {
  it("keeps versions of the right length that add nothing and, from 4 bullets up, keep every number", () => {
    const { condensed, droppedNumbers } = checkVersions(input, {
      versions: [
        { count: 4, bullets: ["Led 6 engineers building the checkout and mentored 3 juniors", "Cut page load time by 40%", "Moved billing to Stripe", "Ran weekly design reviews"] },
        { count: 2, bullets: ["Led 6 engineers on the checkout, cutting load time 40%", "Moved billing to Stripe"] },
      ],
    });
    expect(condensed[4]).toHaveLength(4);
    expect(condensed[2]).toHaveLength(2);
    expect(droppedNumbers).toBe(false);
  });

  it("rejects a wrong length, an invented fact, and a dropped number where there's room", () => {
    const { condensed, droppedNumbers } = checkVersions(input, {
      versions: [
        { count: 4, bullets: ["Led engineers building the checkout", "Cut page load time by 40%", "Moved billing to Stripe", "Mentored juniors"] },
        { count: 2, bullets: ["Grew revenue 300% at Google", "Moved billing to Stripe"] },
      ],
    });
    expect(condensed).toEqual({});
    expect(droppedNumbers).toBe(true);
    expect(checkVersions(input, { versions: [{ count: 2, bullets: ["Only one"] }] }).condensed).toEqual({});
  });
});

describe("roomProblem", () => {
  const original = ["a".repeat(200), "b".repeat(200), "c".repeat(200), "d".repeat(200)];
  it("passes a shorter version that takes less room, and names one that doesn't", () => {
    expect(roomProblem(original, ["x".repeat(200), "y".repeat(190)])).toBeNull();
    expect(roomProblem(original, ["x".repeat(300), "y".repeat(100)])).toMatch(/over 220/);
    expect(roomProblem(original, ["x".repeat(219), "y".repeat(219), "z".repeat(219)].slice(0, 2).concat([]))).toBeNull();
    expect(roomProblem(["a".repeat(100), "b".repeat(100), "c".repeat(100), "d".repeat(100)], ["x".repeat(215), "y".repeat(215)])).toMatch(/more than its share/);
  });
});

describe("condenseBullets", () => {
  it("asks once for every length, and again when numbers went missing", async () => {
    let calls = 0;
    const provider = new MockProvider({
      reply: () => {
        calls += 1;
        return calls === 1
          ? { versions: [{ count: 4, bullets: ["Led engineers", "Cut load time", "Moved billing to Stripe", "Ran weekly design reviews"] }] }
          : { versions: [{ count: 4, bullets: ["Led 6 engineers and mentored 3 juniors", "Cut page load time by 40%", "Moved billing to Stripe", "Ran weekly design reviews"] }] };
      },
    });
    const { data, promptVersion } = await condenseBullets(provider, { ...input, counts: [4] }, options);
    expect(calls).toBe(2);
    expect(data[4]).toHaveLength(4);
    expect(promptVersion).toBe("condense-bullets@6");
    expect(provider.calls[1].system).toContain("Keep every number this time.");
  });

  it("asks again for a length that came back wrong, saying why, only for what's still missing, up to 3 times", async () => {
    let calls = 0;
    const provider = new MockProvider({
      reply: () => {
        calls += 1;
        if (calls === 1) return { versions: [{ count: 4, bullets: ["Led 6 engineers and mentored 3 juniors", "Cut page load time by 40%", "Moved billing to Stripe", "Ran weekly design reviews"] }, { count: 2, bullets: ["Only one"] }] };
        return { versions: [{ count: 2, bullets: ["Grew revenue 300% at Google", "Moved billing to Stripe"] }] };
      },
    });
    const { data } = await condenseBullets(provider, input, options);
    expect(calls).toBe(3);
    expect(data[4]).toHaveLength(4);
    expect(data[2]).toBeUndefined();
    expect(provider.calls[1].system).toContain("the 2-bullet one had 1 bullets, not 2");
    expect(provider.calls[1].messages[0].content).toContain("Counts wanted: 2");
    expect(provider.calls[2].system).toContain("the 2-bullet one said things the original doesn't");
  });

  it("asks nothing when no shorter length is wanted", async () => {
    const provider = new MockProvider({ reply: () => ({ versions: [] }) });
    expect((await condenseBullets(provider, { ...input, counts: [5, 9] }, options)).data).toEqual({});
    expect(provider.calls).toHaveLength(0);
  });
});
