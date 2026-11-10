import { describe, expect, it } from "vitest";

import { afterSteps, bulletBudgets, bulletsAt, byRecency, chooseTrims, fewestTrims, recentCount, startingCounts, trimSteps, wholeRecentTrims, type FitJob } from "./resume-fit";

const job = (id: string, endYear: number | null, bullets: number): FitJob => ({
  id,
  bullets,
  current: endYear === null,
  startYear: 2000,
  startMonth: 1,
  endYear,
  endMonth: endYear ? 6 : null,
});

// In the profile's own order, not by date.
const jobs = [job("2015", 2015, 6), job("now", null, 10), job("2023", 2023, 9), job("2019", 2019, 8), job("2012", 2012, 4), job("2010", 2010, 4), job("2008", 2008, 3)];

const NOW = new Date(2026, 10, 9);

describe("the page rule", () => {
  it("ranks jobs by date, current ones first", () => {
    expect(byRecency(jobs)).toEqual(["now", "2023", "2019", "2015", "2012", "2010", "2008"]);
  });

  it("counts jobs that ended in the last 7 years as recent, and never fewer than 3", () => {
    expect(recentCount(jobs, NOW)).toBe(3);
    expect(recentCount([job("a", 2026, 5), job("b", 2022, 5), job("c", 2022, 5), job("d", 2019, 5), job("e", 2015, 5)], NOW)).toBe(4);
    expect(recentCount([job("a", 2010, 2), job("b", 2009, 1), job("c", 2008, 1), job("d", 2007, 2)], NOW)).toBe(3);
    expect(recentCount([job("a", 2010, 2)], NOW)).toBe(1);
  });

  it("gives the most recent job the most room, each recent job a little less, and older jobs 1 or 2", () => {
    // Like a current job, three recent ones, then two jobs from 2015.
    const career = [job("northwind", 2026, 32), job("ledgerly", 2022, 9), { ...job("kestrel", 2022, 10), endMonth: 1 }, job("brik", 2019, 10), job("ces", 2015, 8), { ...job("consultant", 2015, 10), endMonth: 1 }];
    expect(Object.fromEntries(bulletBudgets(career, 2, NOW)!)).toEqual({
      northwind: { min: 6, max: 8 },
      ledgerly: { min: 5, max: 7 },
      kestrel: { min: 5, max: 6 },
      brik: { min: 3, max: 5 },
      ces: { min: 1, max: 2 },
      consultant: { min: 1, max: 2 },
    });
    expect(bulletBudgets(career, null, NOW)).toBeNull();
  });

  it("starts the recent jobs with all their bullets and older ones with 2, 2 and 1, never more than written", () => {
    expect(Object.fromEntries(startingCounts(jobs, undefined, NOW))).toEqual({ now: 10, 2023: 9, 2019: 8, 2015: 2, 2012: 2, 2010: 1, 2008: 1 });
    expect(Object.fromEntries(startingCounts(jobs, 3, NOW))).toEqual({ now: 10, 2023: 9, 2019: 8, 2015: 3, 2012: 3, 2010: 3, 2008: 3 });
    expect(Object.fromEntries(startingCounts(jobs, null, NOW))).toEqual({ now: 10, 2023: 9, 2019: 8, 2015: 6, 2012: 4, 2010: 4, 2008: 3 });
    expect(Object.fromEntries(startingCounts([job("a", 2010, 2), job("b", 2009, 1), job("c", 2008, 1), job("d", 2007, 3)], undefined, NOW))).toEqual({ a: 2, b: 1, c: 1, d: 2 });
  });

  it("trims older jobs to 1 then to their title line, then projects and publications, then each recent job in turn from the oldest down to 2, and only then to 1, the most recent last", () => {
    const ranked = byRecency(jobs);
    const counts = startingCounts(jobs, undefined, NOW);
    const steps = trimSteps(ranked, counts, ["project:old", "publication:last"], recentCount(jobs, NOW));
    const ids = steps.map((step) => (step.kind === "bullet" ? step.id : `out:${step.id}`));
    // Older: 2015 and 2012 have 2, 2010 and 2008 have 1.
    expect(ids.slice(0, 6)).toEqual(["2012", "2015", "2008", "2010", "2012", "2015"]);
    expect(ids.slice(6, 8)).toEqual(["out:project:old", "out:publication:last"]);
    expect(ids.slice(8, 14)).toEqual(Array(6).fill("2019"));
    expect(ids.slice(14, 21)).toEqual(Array(7).fill("2023"));
    expect(ids.slice(21, 29)).toEqual(Array(8).fill("now"));
    // The page limit holds: the last steps take each recent job to 1, the most recent last.
    expect(ids.slice(29)).toEqual(["2019", "2023", "now"]);
    const floor = afterSteps(counts, steps, 29);
    expect(Object.fromEntries(floor.counts)).toEqual({ now: 2, 2023: 2, 2019: 2, 2015: 0, 2012: 0, 2010: 0, 2008: 0 });
    const end = afterSteps(counts, steps, steps.length);
    expect(Object.fromEntries(end.counts)).toEqual({ now: 1, 2023: 1, 2019: 1, 2015: 0, 2012: 0, 2010: 0, 2008: 0 });
    expect([...end.leftOut]).toEqual(["project:old", "publication:last"]);
  });

  it("finds the fewest trims that fit, by halving", async () => {
    const tried: number[] = [];
    const fits = async (taken: number) => (tried.push(taken), taken >= 13);
    expect(await fewestTrims(30, fits)).toEqual({ taken: 13, fits: true });
    expect(tried.length).toBeLessThan(9);
    expect(await fewestTrims(30, async () => true)).toEqual({ taken: 0, fits: true });
    expect(await fewestTrims(30, async () => false)).toEqual({ taken: 30, fits: false });
  });

  it("uses a job's rewrite for its count, else the nearest longer rewrite, and never cuts points off", () => {
    const bullets = ["a", "b", "c", "d"];
    expect(bulletsAt(bullets, 5, undefined)).toEqual({ bullets, how: "as-written" });
    expect(bulletsAt(bullets, 2, { 2: ["a and b", "c and d"] })).toEqual({ bullets: ["a and b", "c and d"], how: "summarized" });
    expect(bulletsAt(bullets, 2, { 3: ["a and b", "c", "d"] })).toEqual({ bullets: ["a and b", "c", "d"], how: "summarized" });
    expect(bulletsAt(bullets, 2, undefined)).toEqual({ bullets, how: "as-written" });
    expect(bulletsAt(bullets, 2, { 2: ["wrong length"] })).toEqual({ bullets, how: "as-written" });
    expect(bulletsAt(bullets, 0, undefined)).toEqual({ bullets: [], how: "title-only" });
  });
});

describe("a third page, only with leave", () => {
  // Older trims are the first 4; then 6 that shorten the recent jobs. Pages: 4 with no trims, 3 after the older ones, 2 after 8.
  const pagesAt = (taken: number) => (taken >= 8 ? 2 : taken >= 4 ? 3 : 4);
  const fits = async (taken: number, pages: number) => pagesAt(taken) <= pages;

  it("keeps the recent jobs whole when two pages allow it", async () => {
    expect(await chooseTrims(10, 4, 2, "ask", async (taken, pages) => (taken >= 2 ? 2 : 3) <= pages)).toEqual({ taken: 2, fits: true, pages: 2, ask: false });
  });

  it("asks before shortening the recent jobs, fits three pages once allowed, or two if not", async () => {
    expect(await chooseTrims(10, 4, 2, "ask", fits)).toMatchObject({ ask: true });
    expect(await chooseTrims(10, 4, 2, "allow", fits)).toEqual({ taken: 4, fits: true, pages: 3, ask: false });
    expect(await chooseTrims(10, 4, 2, "deny", fits)).toEqual({ taken: 8, fits: true, pages: 2, ask: false });
  });

  it("just fits any other limit", async () => {
    expect(await chooseTrims(10, 4, 1, "ask", fits)).toMatchObject({ ask: false, pages: 1, fits: false });
    // Choosing three pages is the leave: no question, and it stops at three.
    expect(await chooseTrims(10, 4, 3, "ask", fits)).toEqual({ taken: 4, fits: true, pages: 3, ask: false });
  });

  it("counts the trims that keep the recent jobs whole", () => {
    const steps = trimSteps(byRecency(jobs), startingCounts(jobs, undefined, NOW), ["project:old"], 3);
    expect(wholeRecentTrims(steps, byRecency(jobs), 3)).toBe(7);
  });
});
