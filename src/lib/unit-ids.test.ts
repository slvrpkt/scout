import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";
import { resumeContent } from "@/lib/resume-content";

import { withCurrentIds } from "./unit-ids";

describe("withCurrentIds", () => {
  const profile = demoProfile();
  const [first, second] = profile.experience;
  const label = (entry: typeof first) => `${entry.company || entry.role} role`;

  it("leaves units whose ids are current as they are", () => {
    const units = [{ id: `experience:${first.id}`, label: label(first), text: "Mine" }];
    expect(withCurrentIds(units, profile)).toEqual(units);
  });

  it("matches a unit whose job got a new id to the job with its label, so the resume still shows it", () => {
    const units = [
      { id: "summary", label: "Summary", text: "A summary." },
      { id: "experience:gone-1", label: label(first), text: "Tailored for the job" },
      { id: "experience:gone-2", label: label(second).toUpperCase(), text: "Also tailored" },
      { id: "role-skills:gone-1", label: `${first.company || first.role} skills`, text: "Agile, Scrum" },
    ];
    const healed = withCurrentIds(units, profile);
    expect(healed.map((unit) => unit.id)).toEqual(["summary", `experience:${first.id}`, `experience:${second.id}`, `role-skills:${first.id}`]);
    const content = resumeContent(profile, { units });
    expect(content.experience.map((job) => job.id)).toEqual([first.id, second.id]);
    expect(content.experience[0].bullets).toEqual(["Tailored for the job"]);
  });

  it("leaves a unit alone when no job has its label", () => {
    const units = [{ id: "experience:gone", label: "Nowhere Inc. role", text: "x" }];
    expect(withCurrentIds(units, profile)).toEqual(units);
  });
});
