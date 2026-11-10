// Skill groups (#280): a skill can belong to a group, and resumes print one
// labelled line per group ("Technical SEO: Crawl budget · Log analysis").
// The Skills unit stays text, a line per group, so it can be edited like
// any other part of a resume.

export type GroupedSkill = { name: string; group: string };

/** The groups and their skills, each group where its first skill is; skills without a group are the group "". */
export function skillGroups<T extends GroupedSkill>(skills: readonly T[]): { group: string; skills: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const skill of skills) {
    const group = skill.group.trim();
    groups.set(group, [...(groups.get(group) ?? []), skill]);
  }
  return [...groups].map(([group, members]) => ({ group, skills: members }));
}

/** Skills as Profile → Skills shows them: those without a group first, then each group, where its first skill is. */
export function inEditorOrder<T extends GroupedSkill>(skills: readonly T[]): T[] {
  const groups = skillGroups(skills);
  return [...groups.filter(({ group }) => !group), ...groups.filter(({ group }) => group)].flatMap(({ skills: members }) => members);
}

/** The Skills unit: a line per group, in the order its skills come ("Tools: Figma · Ahrefs"), and skills without a group on a line without a label. */
export function skillsText(skills: readonly GroupedSkill[]): string {
  return skillGroups(skills)
    .map(({ group, skills: members }) => `${group ? `${group}: ` : ""}${members.map((skill) => skill.name).join(" · ")}`)
    .join("\n");
}

const LABEL = /^([^:·\n]{1,60}):\s+/;

/** A line of the Skills unit, as its group's label (or none) and its skills. */
export function skillLine(line: string): { label: string | null; text: string } {
  const match = LABEL.exec(line);
  return match ? { label: match[1].trim(), text: line.slice(match[0].length) } : { label: null, text: line };
}

/**
 * The Skills unit (or Tools & platforms) as compact groups for a resume: each
 * group's label and its names, each name once. A name already in `shown`
 * (the Skills above Tools & platforms) is left out, and a group left empty
 * goes. Names seen here are added to `shown`.
 */
export function compactGroups(text: string, shown: Set<string> = new Set()): { label: string | null; names: string[] }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const { label, text: rest } = skillLine(line);
      const names = rest
        .split(/\s+·\s+|\s*;\s*/)
        .map((name) => name.trim())
        .filter((name) => {
          const key = name.toLowerCase();
          if (!name || shown.has(key)) return false;
          shown.add(key);
          return true;
        });
      return names.length > 0 ? [{ label, names }] : [];
    });
}

/** A Skills or Tools text without the names in `hidden` (lower case); a group left empty goes too. */
export function withoutNames(text: string, hidden: ReadonlySet<string>): string {
  if (hidden.size === 0) return text;
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const { label, text: rest } = skillLine(line);
      const names = rest
        .split(/\s+·\s+|\s*;\s*/)
        .map((name) => name.trim())
        .filter((name) => name && !hidden.has(name.toLowerCase()));
      return names.length > 0 ? [`${label ? `${label}: ` : ""}${names.join(" · ")}`] : [];
    })
    .join("\n");
}

/** The skills named in the Skills unit, without the labels. */
export function skillNamesIn(text: string): string[] {
  return text
    .split("\n")
    .flatMap((line) => skillLine(line.trim()).text.split(" · "))
    .map((name) => name.trim())
    .filter(Boolean);
}
