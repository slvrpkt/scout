import { describe, expect, it } from "vitest";

import { filterPage, levelOf, passesFilters, remoteOnly, searchTerms, sourceTypes } from "./filters";
import { EMPTY_QUERY, queryFromParams, searchHref, type FoundPosting } from "./search";

const posting = (patch: Partial<FoundPosting> = {}): FoundPosting => ({
  source: "JSEARCH",
  externalId: "1",
  title: "IT Project Manager",
  company: "Acme",
  place: "Rockville, MD",
  remote: null,
  salary: "",
  postedAt: null,
  url: "",
  via: "",
  description: "Lead delivery.",
  complete: true,
  ...patch,
});

describe("what's searched for", () => {
  it("drops the level words, so every level is found", () => {
    expect(searchTerms("Senior IT Project Manager")).toBe("IT Project Manager");
    expect(searchTerms("Sr. Junior IT project manager")).toBe("IT project manager");
  });

  it("spells out PM and PMO as project manager, and TPM as both technical project and program manager", () => {
    expect(searchTerms("Senior IT PM")).toBe("IT project manager");
    expect(searchTerms("PMO lead")).toBe("project manager");
    expect(searchTerms("TPM")).toBe("technical project manager OR technical program manager");
  });

  it("leaves a product manager alone", () => {
    expect(searchTerms("Senior product PM")).toBe("product PM");
  });
});

describe("what's kept", () => {
  it("reads the level from the title, then the years asked for", () => {
    expect(levelOf(posting({ title: "VP of Engineering" }))).toBe("executive");
    expect(levelOf(posting({ title: "Director, PMO" }))).toBe("director");
    expect(levelOf(posting({ title: "Senior IT Project Manager" }))).toBe("senior");
    expect(levelOf(posting({ title: "Junior Analyst" }))).toBe("entry");
    expect(levelOf(posting({ title: "Project Coordinator", description: "8+ years of experience" }))).toBe("senior");
    expect(levelOf(posting({ title: "IT Project Manager" }))).toBe("manager");
    expect(levelOf(posting({ title: "Analyst" }))).toBeNull();
  });

  it("hides only what clearly doesn't fit: an unknown work mode, level or pay stays", () => {
    const filters = { workModes: ["remote" as const], levels: ["senior" as const, "manager" as const], minSalary: 110_000 };
    expect(passesFilters(posting({ remote: true, salary: "$120,000 - $150,000 a year" }), filters)).toBe(true);
    expect(passesFilters(posting({ remote: false }), filters)).toBe(false);
    expect(passesFilters(posting({ remote: true, salary: "$80,000 - $95,000 a year" }), filters)).toBe(false);
    expect(passesFilters(posting({ remote: true, title: "Director of IT" }), filters)).toBe(false);
    // Says nothing about its work mode, level or pay: kept.
    expect(passesFilters(posting({ title: "Analyst" }), filters)).toBe(true);
  });

  it("checks the employment type the source gives, and spots volunteer roles", () => {
    expect(passesFilters(posting({ employmentType: "CONTRACTOR" }), { types: ["fulltime"] })).toBe(false);
    expect(passesFilters(posting({ employmentType: "FULLTIME" }), { types: ["fulltime"] })).toBe(true);
    expect(passesFilters(posting({ title: "Volunteer Project Manager" }), { types: ["volunteer"] })).toBe(true);
    expect(passesFilters(posting({ title: "Volunteer Project Manager" }), { types: ["fulltime"] })).toBe(false);
  });

  it("counts what it hides", () => {
    const page = filterPage({ postings: [posting({ remote: true }), posting({ remote: false })], next: null }, { ...EMPTY_QUERY, workModes: ["remote"] });
    expect(page.postings).toHaveLength(1);
    expect(page.hidden).toBe(1);
  });
});

describe("what the source is asked", () => {
  it("asks for remote only when it's the only mode, and for the employment types it knows", () => {
    expect(remoteOnly({ workModes: ["remote"], remoteOnly: false })).toBe(true);
    expect(remoteOnly({ workModes: ["remote", "hybrid"], remoteOnly: false })).toBe(false);
    expect(sourceTypes({ types: ["fulltime", "contract"] })).toEqual(["FULLTIME", "CONTRACTOR"]);
    expect(sourceTypes({ types: ["volunteer", "fulltime"] })).toBeNull();
  });

  it("keeps the filters in the Manual job search link", () => {
    const query = { ...EMPTY_QUERY, keywords: "IT PM", country: "us", workModes: ["remote" as const, "hybrid" as const], levels: ["senior" as const], types: ["fulltime" as const], minSalary: 110000 };
    const params = Object.fromEntries(new URL(searchHref(query), "http://x").searchParams);
    expect(queryFromParams(params)).toMatchObject({ workModes: ["remote", "hybrid"], levels: ["senior"], types: ["fulltime"], minSalary: 110000 });
  });
});
