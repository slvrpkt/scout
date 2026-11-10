import { describe, expect, it } from "vitest";

import { companyInTitle, employerMatches, withCompany } from "./company";

describe("company searches", () => {
  it("matches the company asked for, whatever its legal form or division", () => {
    expect(employerMatches("Accenture Federal Services", "Accenture")).toBe(true);
    expect(employerMatches("Leidos Holdings, Inc.", "Leidos")).toBe(true);
    expect(employerMatches("Booz Allen Hamilton", "BoozAllen")).toBe(true);
    expect(employerMatches("BoozAllen", "Booz Allen")).toBe(true);
    expect(employerMatches("Ernst & Young LLP", "Ernst and Young")).toBe(true);
  });

  it("doesn't match another company that only shares letters or a word", () => {
    expect(employerMatches("Metaphor Inc", "Meta")).toBe(false);
    expect(employerMatches("Deloitte", "Accenture")).toBe(false);
    expect(employerMatches("General Dynamics", "General Motors")).toBe(false);
    expect(employerMatches("", "Accenture")).toBe(false);
  });

  it("puts the company in the search's words, with or without a title", () => {
    expect(withCompany("Project Manager", "Accenture")).toBe("Project Manager at Accenture");
    expect(withCompany("", "Accenture")).toBe("jobs at Accenture");
    expect(withCompany("Project Manager", undefined)).toBe("Project Manager");
  });

  it("finds a company written into a title", () => {
    expect(companyInTitle("Project Manager at Leidos")).toBe("Leidos");
    expect(companyInTitle("Technical Project Manager")).toBeNull();
  });
});
