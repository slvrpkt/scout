import { describe, expect, it } from "vitest";

import { demoProfile, demoResumeUnits } from "@/lib/demo-profile";
import { resumeContent } from "@/lib/resume-content";

import { addHeadingUnit, carryHeadings, LOCATION_UNIT, profileLocation, ROLE_HEAD, withHeadingUnits } from "./resume-heading";

describe("a resume's own headings", () => {
  const profile = demoProfile();
  const units = demoResumeUnits();
  const job = profile.experience.find((entry) => units.some((unit) => unit.id === `experience:${entry.id}`))!;
  const head = `${ROLE_HEAD}${job.id}`;

  it("are drawn from the profile until changed, each before its job", () => {
    const shown = withHeadingUnits(units, profile);
    const index = shown.findIndex((unit) => unit.id === head);
    expect(shown[index + 1].id).toBe(`experience:${job.id}`);
    expect(shown[index].text).toBe([job.role, job.company, job.location].map((part) => part.trim()).join("\n"));
    // Drawn as the profile has them, the resume reads the same.
    expect(resumeContent(profile, { units: shown })).toEqual(resumeContent(profile, { units }));
  });

  it("show this resume's title, company and place, and location, leaving the profile alone", () => {
    const changed = addHeadingUnit(addHeadingUnit(units, { id: head, label: "heading", text: "Lead Designer\nNew Name BV\nHaarlem" }), {
      id: LOCATION_UNIT,
      label: "Your location",
      text: "Leiden",
    });
    const content = resumeContent(profile, { units: changed });
    const role = content.experience.find((entry) => entry.id === job.id)!;
    expect(role.role).toBe("Lead Designer");
    expect(role.company).toBe("New Name BV, Haarlem");
    expect(content.contacts).toContain("Leiden");
    expect(content.contacts).not.toContain(profileLocation(profile.basics));
    expect(demoProfile().experience.find((entry) => entry.id === job.id)!.role).toBe(job.role);
  });

  it("stay through a rewrite, for the jobs still on it", () => {
    const changed = addHeadingUnit(units, { id: head, label: "heading", text: "Lead Designer\nAcme\n" });
    expect(carryHeadings(changed, units).find((unit) => unit.id === head)?.text).toBe("Lead Designer\nAcme\n");
    expect(carryHeadings(changed, units.filter((unit) => unit.id !== `experience:${job.id}`)).some((unit) => unit.id === head)).toBe(false);
  });
});
