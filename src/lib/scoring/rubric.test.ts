import { describe, expect, it } from "vitest";

import { breakdownOf, criteriaOf, RUBRIC_FIT_ID, rubricSchema, rubricScore, rubricTag, type RubricItem } from "./rubric";

const rubric: RubricItem[] = [
  { id: RUBRIC_FIT_ID, label: "How well it fits your profile", points: 50 },
  { id: "remote", label: "Remote", points: 25 },
  { id: "hybrid", label: "Hybrid", points: 10 },
  { id: "salary", label: "Salary over $120k", points: 15 },
];

describe("rubricScore", () => {
  it("adds up the points: all when met, half when partly or unknown, none when not, the fit item as Scout's score", () => {
    const { score, breakdown } = rubricScore(rubric, 80, [
      { id: "remote", verdict: "yes", note: "Fully remote." },
      { id: "hybrid", verdict: "partly", note: "" },
      { id: "salary", verdict: "unknown", note: "No salary given." },
    ]);
    // 40 + 25 + 5 + 7.5 = 77.5 of 100
    expect(score).toBe(78);
    expect(breakdown.map((line) => [line.label, line.earned])).toEqual([
      ["How well it fits your profile", 40],
      ["Remote", 25],
      ["Hybrid", 5],
      ["Salary over $120k", 7.5],
    ]);
    expect(breakdown[0]).toMatchObject({ verdict: "score", note: "Scored 80 of 100" });
  });

  it("turns the points into 0–100 when they don't add up to 100", () => {
    expect(rubricScore([{ id: "remote", label: "Remote", points: 25 }, { id: "hybrid", label: "Hybrid", points: 25 }], 10, [{ id: "remote", verdict: "yes", note: "" }]).score).toBe(75);
  });

  it("counts a criterion the scorer didn't judge as unknown: half its points", () => {
    expect(rubricScore([{ id: "remote", label: "Remote", points: 25 }], 90, []).score).toBe(50);
  });
});

describe("the rubric's shape", () => {
  it("takes points in steps of 5 from 5 to 100, and unique ids", () => {
    expect(rubricSchema.safeParse(rubric).success).toBe(true);
    expect(rubricSchema.safeParse([{ id: "a", label: "Remote", points: 12 }]).success).toBe(false);
    expect(rubricSchema.safeParse([{ id: "a", label: "Remote", points: 0 }]).success).toBe(false);
    expect(rubricSchema.safeParse([{ id: "a", label: "A", points: 5 }, { id: "a", label: "B", points: 5 }]).success).toBe(false);
  });

  it("judges every criterion but the fit item", () => {
    expect(criteriaOf(rubric).map((item) => item.id)).toEqual(["remote", "hybrid", "salary"]);
  });

  it("tags a rubric the same way every time, and a changed one differently", () => {
    expect(rubricTag(rubric)).toBe(rubricTag([...rubric]));
    expect(rubricTag(rubric)).not.toBe(rubricTag([{ ...rubric[0], points: 45 }, ...rubric.slice(1)]));
  });

  it("reads a stored breakdown, leaving out what doesn't fit", () => {
    expect(breakdownOf([{ label: "Remote", points: 25, earned: 25, verdict: "yes", note: "" }, { label: 3 }])).toHaveLength(1);
    expect(breakdownOf(null)).toBeUndefined();
    expect(breakdownOf([])).toBeUndefined();
  });
});
