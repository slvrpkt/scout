import { describe, expect, it } from "vitest";

import { withoutTraps } from "@/lib/ai/tasks/tailor-resume";

import { mentionsTrap, stripTraps, trapsForPrompt } from "./screening-traps";

const traps = [{ term: "Cribbage", why: "Not a programming language." }];

describe("resume screening traps", () => {
  it("takes a trap word out with the comma or 'and' that joined it", () => {
    expect(stripTraps("Python, Cribbage, Java", traps)).toBe("Python, Java");
    expect(stripTraps("Python, Java and Cribbage", traps)).toBe("Python, Java");
    expect(stripTraps("Cribbage, Python", traps)).toBe("Python");
    expect(stripTraps("Built services in Python and cribbage.", traps)).toBe("Built services in Python.");
    // Only the whole word: "Cribbages" or a longer name isn't it.
    expect(stripTraps("Python, Cribbageous", traps)).toBe("Python, Cribbageous");
  });

  it("knows when a text uses one, and tells the writer to stay clear of them", () => {
    expect(mentionsTrap("Skilled in CRIBBAGE", traps)).toBe(true);
    expect(mentionsTrap("Skilled in Python", traps)).toBe(false);
    expect(trapsForPrompt(traps)).toContain("- Cribbage");
    expect(trapsForPrompt([])).toBe("");
  });

  it("keeps it out of every part of a tailored resume, dropping a part it empties", () => {
    const units = [
      { id: "skills", label: "Skills", text: "Python, Cribbage, Java" },
      { id: "role-skills:a", label: "Acme skills", text: "Cribbage" },
      { id: "experience:a", label: "Acme role", text: "Led delivery in Python and Cribbage.\nRan the release train." },
    ];
    expect(withoutTraps(units, traps)).toEqual([
      { id: "skills", label: "Skills", text: "Python, Java" },
      { id: "experience:a", label: "Acme role", text: "Led delivery in Python.\nRan the release train." },
    ]);
    expect(withoutTraps(units, [])).toBe(units);
  });
});
