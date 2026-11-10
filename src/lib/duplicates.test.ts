import { describe, expect, it } from "vitest";

import { companyKey, findDuplicate, matchOne, type LogEntry } from "./duplicates";

const entry: LogEntry = {
  id: "app1",
  label: "Acme – Product Designer",
  url: "https://jobs.acme.com/designer?utm_source=linkedin",
  company: "Acme, Inc.",
  role: "Product Designer",
  place: "Austin, TX",
  postedAt: "2026-10-20",
  deadline: new Date("2026-11-30"),
};

describe("matchOne", () => {
  it("calls the same posting link a duplicate, tracking parameters aside", () => {
    expect(matchOne({ url: "https://www.jobs.acme.com/designer/", company: "Other" }, entry)).toMatchObject({ kind: "duplicate", why: "Same posting link", applicationId: "app1" });
  });

  it("calls the same company, role and place a duplicate", () => {
    expect(matchOne({ company: "ACME", role: "product designer", place: "Austin" }, entry)).toMatchObject({ kind: "duplicate", why: "Same company, role and location" });
    expect(matchOne({ company: "Acme", role: "Product Designer" }, entry)).toMatchObject({ kind: "duplicate", why: "Same company and role" });
  });

  it("calls it potential when something differs or the role is only similar", () => {
    expect(matchOne({ company: "Acme", role: "Product Designer", place: "Boston, MA" }, entry)).toMatchObject({
      kind: "potential",
      why: "Same company and role, but a different location",
    });
    expect(matchOne({ company: "Acme", role: "Product Designer", deadline: "2026-12-15" }, entry)?.why).toBe("Same company and role, but a different apply-by date");
    expect(matchOne({ company: "Acme", role: "Product Designer", postedAt: "2026-06-01" }, entry)?.why).toBe("Same company and role, but a different posted date");
    expect(matchOne({ company: "Acme", role: "Senior Product Designer", place: "Austin" }, entry)).toMatchObject({ kind: "potential", why: "Same company and a similar role" });
  });

  it("doesn't match another company or an unrelated role", () => {
    expect(matchOne({ company: "Globex", role: "Product Designer" }, entry)).toBeNull();
    expect(matchOne({ company: "Acme", role: "Backend Engineer" }, entry)).toBeNull();
    expect(matchOne({ company: "", role: "Product Designer" }, entry)).toBeNull();
  });

  it("treats Remote as no place at all", () => {
    expect(matchOne({ company: "Acme", role: "Product Designer", place: "Remote" }, entry)?.kind).toBe("duplicate");
  });
});

describe("findDuplicate", () => {
  const potential: LogEntry = { ...entry, id: "app0", url: "", role: "Designer" };
  it("prefers a duplicate over an earlier potential one, and skips excluded applications", () => {
    expect(findDuplicate({ company: "Acme", role: "Product Designer" }, [potential, entry])?.applicationId).toBe("app1");
    expect(findDuplicate({ company: "Acme", role: "Product Designer" }, [potential, entry], { exclude: ["app1"] })).toMatchObject({ applicationId: "app0", kind: "potential" });
    expect(findDuplicate({ company: "Acme", role: "Product Designer" }, [])).toBeNull();
  });
});

it("companyKey drops legal suffixes", () => {
  expect(companyKey("The Acme Group GmbH")).toBe("acme");
});
