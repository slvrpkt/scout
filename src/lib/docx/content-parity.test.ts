import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { demoProfile } from "@/lib/demo-profile";
import { resumeContent } from "@/lib/resume-content";
import { BUILT_IN_THEMES } from "@/lib/themes";

import { resumeDocx } from "./render";

const wordText = async (bytes: Uint8Array) => {
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
  return [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((match) => match[1]).join(" ").replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"');
};

describe("the Word resume", () => {
  it("holds everything the PDF does", async () => {
    const profile = demoProfile();
    const text = await wordText(await resumeDocx({ theme: BUILT_IN_THEMES[0], profile, paper: "LETTER", includeReferences: true }));
    const content = resumeContent(profile, { includeReferences: true });
    const parts = [
      content.name,
      content.headline,
      ...content.contacts,
      content.summary,
      ...content.experience.flatMap((role) => [role.role, role.company, role.dates, role.descriptor, ...role.bullets, ...role.skills]),
      ...content.projects.flatMap((project) => [project.name, project.link, project.dates, ...project.bullets, ...project.skills]),
      ...content.education.flatMap((entry) => [entry.degree, entry.school, entry.dates, entry.notes]),
      ...content.certifications.flatMap((entry) => [entry.name, entry.detail]),
      ...content.references.flatMap((entry) => [entry.name, entry.role, entry.contact]),
      content.languages,
    ].filter(Boolean);
    expect(parts.filter((part) => !text.includes(part))).toEqual([]);
  });
});
