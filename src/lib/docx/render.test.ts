import mammoth from "mammoth";
import { describe, expect, it } from "vitest";

import { DateFormat, PaperSize, ThemeFont, Tone } from "@/generated/prisma/enums";
import { demoLetterUnits, demoProfile, demoResumeUnits } from "@/lib/demo-profile";
import { BUILT_IN_THEMES } from "@/lib/themes";

import { letterDocx, markedRuns, resumeDocx, wordFont } from "./render";

const theme = BUILT_IN_THEMES[0];
/** A Word file's text, read back the way the resume import reads one. */
const textOf = async (file: Uint8Array) => (await mammoth.extractRawText({ buffer: Buffer.from(file) })).value;
const isZip = (file: Uint8Array) => file[0] === 0x50 && file[1] === 0x4b;

describe("resumeDocx", () => {
  it("writes the base resume from the profile", async () => {
    const profile = demoProfile();
    const file = await resumeDocx({ theme, profile, paper: PaperSize.A4 });
    expect(isZip(file)).toBe(true);
    const text = await textOf(file);
    expect(text).toContain(profile.basics.name);
    expect(text).toContain("jane.doe@example.com");
    expect(text).toContain("EXPERIENCE");
    for (const role of profile.experience) expect(text).toContain(role.company);
    expect(text).toContain(profile.experience[0].bullets.split("\n")[0].trim());
  });

  it("writes a tailored resume from its units, leaving out what they leave out", async () => {
    const profile = demoProfile();
    const units = demoResumeUnits().filter((unit) => unit.id !== `experience:${profile.experience.at(-1)!.id}`);
    const text = await textOf(await resumeDocx({ theme, profile, paper: PaperSize.LETTER, units }));
    expect(text).toContain(units.find((unit) => unit.id === "summary")!.text.trim().slice(0, 40));
    expect(text).not.toContain(`${profile.experience.at(-1)!.role}, ${profile.experience.at(-1)!.company}`);
  });
});

describe("letterDocx", () => {
  it("writes the sender, date, greeting, paragraphs and sign-off", async () => {
    const profile = demoProfile();
    const units = demoLetterUnits();
    const text = await textOf(
      await letterDocx({
        theme,
        paper: PaperSize.A4,
        basics: profile.basics,
        units,
        company: "Ledgerly",
        location: "Amsterdam",
        tone: Tone.WARM,
        date: new Date(Date.UTC(2026, 10, 3)),
        dateFormat: DateFormat.DAY_MONTH_YEAR,
      }),
    );
    expect(text).toContain(profile.basics.name);
    expect(text).toContain("Ledgerly");
    expect(text).toContain("2026");
    for (const unit of units) expect(text).toContain(unit.text.trim().split("\n")[0]);
  });
});

describe("wordFont", () => {
  it("uses fonts every copy of Word has", () => {
    expect(wordFont(ThemeFont.GARAMOND)).toBe("Cambria");
    expect(wordFont(ThemeFont.CALIBRI)).toBe("Calibri");
    expect(wordFont(ThemeFont.SEGOE_UI)).toBe("Segoe UI");
    expect(wordFont(ThemeFont.INTER)).toBe("Calibri");
    expect(wordFont(ThemeFont.PLEX_MONO)).toBe("Consolas");
  });
});

describe("markedRuns", () => {
  it("splits **bold** and *italic* into runs", () => {
    expect(markedRuns("Doe, J. **Title**. *Journal*, 2024.")).toHaveLength(5);
    expect(markedRuns("No marks")).toHaveLength(1);
  });
});
