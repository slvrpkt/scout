import type { FoundPosting } from "@/lib/job-search/search";
import { howToApply } from "@/lib/job-search/how-to-apply";

type ApplyLink = NonNullable<FoundPosting["applyLinks"]>[number];

/** What each place to apply is called on the card. */
function labelOf(link: ApplyLink): string {
  if (link.kind === "linkedin") return "LinkedIn";
  if (link.kind === "direct") {
    // The employer's own page, or its hiring tool (Workday, Greenhouse…).
    const tool = /^Apply via (.+)$/.exec(howToApply(link.url)?.label ?? "")?.[1];
    return tool ? `Company site (via ${tool})` : "Company website";
  }
  return link.publisher ? `Where it was found: ${link.publisher}` : "Where it was found";
}

/**
 * How to apply for a posting, on its card: the employer's own page first,
 * then LinkedIn, then where the source found it, as far as the source says.
 * With only one link known, that one; with none, nothing.
 */
export function HowToApply({ url, links = [] }: { url: string; links?: readonly ApplyLink[] }) {
  if (links.length === 0) {
    const apply = howToApply(url);
    if (!apply) return null;
    return (
      <p className="text-meta text-muted">
        How to apply:{" "}
        <a href={apply.url} target="_blank" rel="noreferrer" className="font-medium text-ink underline underline-offset-2">
          {apply.label}
          <span aria-hidden="true"> ↗</span>
        </a>
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-meta text-muted">
      <span>How to apply:</span>
      {links.map((link, index) => (
        <span key={link.url} className="inline-flex items-baseline gap-2">
          {index > 0 && <span aria-hidden="true">·</span>}
          <a href={link.url} target="_blank" rel="noreferrer" className="font-medium text-ink underline underline-offset-2">
            {index + 1}. {labelOf(link)}
            <span aria-hidden="true"> ↗</span>
          </a>
        </span>
      ))}
    </p>
  );
}
