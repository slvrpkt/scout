import { describe, expect, it, vi } from "vitest";

import { demoProfile } from "@/lib/demo-profile";
import { changedPieces, profilePieces } from "@/lib/profile-pieces";

import { proofreadProfile } from "./proofread-profile";

const model = (answer: unknown) => ({ kind: "MOCK", model: "m", complete: vi.fn(async () => answer) }) as never;
const options = { creativity: "BALANCED", strict: true, language: null } as never;

describe("proofreadProfile", () => {
  it("lists real mistakes, and drops ones that change nothing or aren't in the text", async () => {
    const pieces = [{ where: "Education: Tech, degree", text: "B. Sc. In Nanosystems" }];
    const { data } = await proofreadProfile(
      model({ issues: [{ where: "Education", wrong: "B. Sc. In", right: "B.Sc. in" }, { where: "x", wrong: "same", right: "same" }, { where: "x", wrong: "made up", right: "Made up" }] }),
      { pieces },
      options,
    );
    expect(data).toEqual([{ where: "Education", wrong: "B. Sc. In", right: "B.Sc. in" }]);
  });

  it("asks nothing when nothing changed", async () => {
    const provider = model({ issues: [] });
    expect((await proofreadProfile(provider, { pieces: [] }, options)).data).toEqual([]);
    expect((provider as unknown as { complete: ReturnType<typeof vi.fn> }).complete).not.toHaveBeenCalled();
  });
});

describe("profilePieces", () => {
  it("collects the prose, not emails, links or ids, and sends only what changed", () => {
    const profile = demoProfile();
    const pieces = profilePieces(profile);
    expect(pieces.length).toBeGreaterThan(5);
    expect(pieces.some((piece) => piece.text.includes("@") || piece.text.startsWith("http"))).toBe(false);
    const checked = new Set(pieces.map((piece) => piece.text));
    const role = profile.experience[0];
    const edited = { ...profile, experience: [{ ...role, bullets: ["Lead the the team", ...role.bullets.slice(1)] }, ...profile.experience.slice(1)] };
    expect(changedPieces(profilePieces(edited as typeof profile), checked)).toEqual([{ where: expect.stringMatching(/^Experience: .*, bullet 1$/), text: "Lead the the team" }]);
  });
});
