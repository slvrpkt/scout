import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";
import type { ProfileData } from "@/lib/profile";

import { bulletBudgets } from "@/lib/resume-fit";

import { fingerprintOf, savedVersion, shorterCounts, versionAt, versionBullets, versionKey } from "./base-resume";

const job = (id: string, endYear: number | null, bullets: number) => ({
  ...demoProfile().experience[0],
  id,
  company: `Company ${id}`,
  startYear: 2000,
  startMonth: 1,
  endYear,
  endMonth: endYear ? 6 : null,
  current: endYear === null,
  bullets: Array.from({ length: bullets }, (_, index) => `Bullet ${index + 1} at ${id}`).join("\n"),
});

const profile: ProfileData = {
  ...demoProfile(),
  experience: [job("now", null, 10), job("2023", 2023, 8), job("2020", 2020, 6), job("2017", 2017, 7), job("2014", 2014, 4)],
  projects: [],
  publications: [],
};

describe("the base resume's versions", () => {
  it("gives the jobs of the last 7 years the most room for two pages, the most recent the most, and older ones 1 or 2", () => {
    const budgets = bulletBudgets(profile.experience.map((entry) => ({ ...entry, bullets: entry.bullets.split("\n").length })), 2, new Date(2026, 10, 9))!;
    expect(Object.fromEntries(budgets)).toEqual({ now: { min: 6, max: 8 }, 2023: { min: 5, max: 7 }, 2020: { min: 5, max: 6 }, 2017: { min: 1, max: 2 }, 2014: { min: 1, max: 2 } });
    expect(bulletBudgets([], null)).toBeNull();
  });

  it("shows each job's first points within its budget until the AI has chosen, then the AI's", () => {
    expect(versionBullets(profile, "2", {}).now).toHaveLength(8);
    expect(versionBullets(profile, "full", {}).now).toHaveLength(10);
    const chosen = { "2": { from: versionKey(profile, "2"), bullets: { now: ["Led it all", "Shipped it"] } } };
    expect(versionBullets(profile, "2", chosen).now).toEqual(["Led it all", "Shipped it"]);
    expect(savedVersion(profile, "2", chosen)).not.toBeNull();
  });

  it("goes out of date when a job or the title changes", () => {
    const chosen = { "2": { from: versionKey(profile, "2"), bullets: {} } };
    const edited = { ...profile, experience: [{ ...profile.experience[0], bullets: "Something new" }, ...profile.experience.slice(1)] };
    expect(savedVersion(edited, "2", chosen)).toBeNull();
    expect(savedVersion({ ...profile, basics: { ...profile.basics, headline: "Program Manager" } }, "2", chosen)).toBeNull();
    expect(fingerprintOf(profile.experience[0])).not.toBe(fingerprintOf(edited.experience[0]));
  });

  it("brings older jobs down a point first, re-summarized at the new length, and says so", () => {
    // 2017 and 2014 start at 2: one point off each, the oldest first.
    const summaries = { 2017: { 1: ["2017 in one"] }, 2014: { 1: ["2014 in one"] } };
    const chosen = { "2": { from: versionKey(profile, "2"), bullets: versionBullets(profile, "2", {}), summaries } };
    const fitted = versionAt(profile, "2", chosen, 2);
    expect(fitted.condense.bullets["2014"]).toEqual(["2014 in one"]);
    expect(fitted.condense.bullets["2017"]).toEqual(["2017 in one"]);
    expect(fitted.condense.bullets.now).toHaveLength(8);
    expect(fitted.dropped).toEqual(["Company 2017: re-summarized from 2 points to 1", "Company 2014: re-summarized from 2 points to 1"]);
  });

  it("then shows older jobs as their title line alone, keeping the history, before the recent jobs shrink", () => {
    const fitted = versionAt(profile, "2", {}, 4);
    expect(fitted.condense.bullets["2014"]).toEqual([]);
    expect(fitted.condense.bullets["2017"]).toEqual([]);
    expect(fitted.condense.bullets["2020"]).toHaveLength(6);
    expect(fitted.dropped).toContain("Company 2014: shown as its title and dates only");
  });

  it("never cuts a point: without a shorter version written, the job stays as it is and says so", () => {
    expect(versionAt(profile, "2", {}, 1).dropped).toEqual(["Company 2014: kept at 2 points, as a shorter version couldn't be written"]);
    expect(versionAt(profile, "2", {}, 1).condense.bullets["2014"]).toHaveLength(2);
  });

  it("asks for summaries down to 1 point for every job, as the page limit's last resort reaches 1", () => {
    const counts = shorterCounts(profile, versionBullets(profile, "2", {}));
    expect(counts.get("2014")).toEqual([1]);
    expect(counts.get("now")).toEqual([7, 6, 5, 4, 3, 2, 1]);
  });
});
