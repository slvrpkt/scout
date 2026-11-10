import { howToApply } from "@/lib/job-search/how-to-apply";

/** How to apply for a posting, with the link, on its card. */
export function HowToApply({ url }: { url: string }) {
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
