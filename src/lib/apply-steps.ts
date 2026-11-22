import { SIGN_OFF_UNIT } from "@/lib/application-data";
import { howToApply } from "@/lib/job-search/how-to-apply";
import type { FoundPosting } from "@/lib/job-search/search";

// Quick Apply, on an application's page: which page to open
// to apply, and the cover letter as text to paste into a form. Pure, so it's
// tested alone.

type ApplyLink = NonNullable<FoundPosting["applyLinks"]>[number];

/** Where to apply: its link, what it's called, and whether it's the employer's own (the shortest way to its form). */
export type ApplyPage = { url: string; label: string; direct: boolean };

/** Job boards: a link there is one more step from the employer's form. */
const BOARDS = new Set(["LinkedIn", "Indeed", "Glassdoor", "ZipRecruiter", "Monster"]);

/** The hiring tool or board a link goes to, e.g. "Workday"; null for any other website. */
const placeOf = (url: string) => /^Apply via (.+)$/.exec(howToApply(url)?.label ?? "")?.[1] ?? null;

/**
 * The page to apply on: the employer's own first, then LinkedIn, then where
 * the source found it; without those, the posting's link, which is the
 * employer's unless it's a known job board. Null without a usable link.
 */
export function applyPage(links: readonly ApplyLink[], postingUrl: string): ApplyPage | null {
  const link = (["direct", "linkedin", "source"] as const).map((kind) => links.find((entry) => entry.kind === kind)).find(Boolean);
  if (link) {
    const place = placeOf(link.url);
    if (link.kind === "direct") return { url: link.url, label: place ? `the company's site (via ${place})` : "the company's site", direct: true };
    if (link.kind === "linkedin") return { url: link.url, label: "LinkedIn", direct: false };
    return { url: link.url, label: link.publisher || place || "the job board", direct: false };
  }
  const apply = howToApply(postingUrl);
  if (!apply) return null;
  const place = placeOf(apply.url);
  if (place && BOARDS.has(place)) return { url: apply.url, label: place, direct: false };
  return { url: apply.url, label: place ? `the company's site (via ${place})` : "the company's site", direct: true };
}

/** The cover letter as a form's text box takes it: greeting, paragraphs, sign-off and name, a blank line apart. */
export function letterText(units: readonly { id: string; text: string }[]): string {
  const text = (id: string) => units.find((unit) => unit.id === id)?.text.trim() ?? "";
  const paragraphs = units.filter((unit) => unit.id.startsWith("paragraph:")).map((unit) => unit.text.trim());
  const closing = [text(SIGN_OFF_UNIT), text("signature")].filter(Boolean).join("\n");
  return [text("greeting"), ...paragraphs, closing].filter(Boolean).join("\n\n");
}
