// Why a posting is in Archived, from the note it was archived with: for the
// Archived filter's "Why", so a skip list that catches too much shows up.

export const ARCHIVE_REASONS = [
  { id: "title", label: "Job title" },
  { id: "word", label: "Your words" },
  { id: "distance", label: "Too far" },
  { id: "minimum", label: "Can't reach your minimum" },
  { id: "search", label: "A search's skip rule" },
  { id: "you", label: "Archived by you" },
] as const;

export type ArchiveReason = (typeof ARCHIVE_REASONS)[number]["id"];

/**
 * The reason, from the first red flag: "Skipped by its title: …", or
 * "Skipped by your rule “…”: …" with what the rule was. None: you archived it.
 */
export function archiveReasonOf(redFlags: readonly string[]): ArchiveReason {
  const first = redFlags[0] ?? "";
  if (first.startsWith("Skipped by its title")) return "title";
  const rule = /^Skipped by your rule “([^”]*)”(?::\s*(.*))?$/.exec(first);
  if (!rule) return "you";
  const [, name, note = ""] = rule;
  if (/^minimum score \d+$/.test(name) || /^draft score \d+$/.test(name)) return "minimum";
  if (/^within \d+ miles$/.test(name)) return "distance";
  if (note === "the posting mentions it") return "word";
  return "search";
}

/** The start of the period an archived posting is counted in: today, this week (from Monday) or this month, in local time. */
export function periodStart(period: "today" | "week" | "month", now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (period === "month") start.setDate(1);
  return start.getTime();
}
