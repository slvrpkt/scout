import { describe, expect, it } from "vitest";

import { draftsInOrder } from "./view";

const draft = (name: string, score: number, applicationId: string | null = name) => ({ name, score, applicationId, fresh: null });

describe("Drafts to review, the most worth your time first", () => {
  it("goes by fit score until a resume is graded, then by fit and grade together", () => {
    const drafts = [draft("a", 95), draft("b", 90), draft("c", 88)];
    expect(draftsInOrder(drafts, new Map()).map((entry) => entry.name)).toEqual(["a", "b", "c"]);
    // a's resume grades poorly, c's well: c now leads, a drops to last.
    const grades = new Map([["a", 60], ["b", 85], ["c", 99]]);
    expect(draftsInOrder(drafts, grades).map((entry) => entry.name)).toEqual(["c", "b", "a"]);
  });

  it("ranks an ungraded draft by its fit score among graded ones, breaking ties by fit", () => {
    // All three come to 86: graded (90+82)/2, tie (94+78)/2, ungraded 86.
    const drafts = [draft("graded", 90), draft("ungraded", 86, null), draft("tie", 94)];
    expect(draftsInOrder(drafts, new Map([["graded", 82], ["tie", 78]])).map((entry) => entry.name)).toEqual(["tie", "graded", "ungraded"]);
  });
});
