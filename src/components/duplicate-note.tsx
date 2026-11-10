import Link from "next/link";

import { cn } from "@/lib/cn";
import type { DuplicateMatch } from "@/lib/duplicates";

const WORDS = { duplicate: "Duplicate", potential: "Potential duplicate" } as const;

/** "Duplicate" or "Potential duplicate", as a small pill in a list (#43). */
export function DuplicateBadge({ match, className }: { match: DuplicateMatch; className?: string }) {
  return (
    <span
      title={`${match.why}: ${match.label}`}
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        match.kind === "duplicate" ? "bg-danger-surface text-error" : "bg-warning-surface text-ink",
        className,
      )}
    >
      {WORDS[match.kind]}
    </span>
  );
}

/** The match in full: what it is, why, and a link to the application in the log (#43). */
export function DuplicateNote({ match, className }: { match: DuplicateMatch; className?: string }) {
  return (
    <p
      role="note"
      className={cn(
        "rounded-card border px-4 py-3 text-meta",
        match.kind === "duplicate" ? "border-danger-line bg-danger-surface" : "border-warning-line bg-warning-surface",
        className,
      )}
    >
      <strong className="font-semibold">{WORDS[match.kind]}</strong> of{" "}
      <Link href={`/applications/${match.applicationId}`} className="underline underline-offset-2">
        {match.label}
      </Link>{" "}
      in your Job application log. {match.why}.
    </p>
  );
}
