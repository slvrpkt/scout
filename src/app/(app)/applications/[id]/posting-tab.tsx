"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { toast } from "@/components/toast";
import { MatchRows } from "@/components/match-rows";
import type { Match, Requirement } from "@/lib/application-data";
import { saveApplicationNotes } from "@/lib/fact-actions";
import type { FactItem } from "@/lib/profile";

import { sectionHref } from "../../profile/sections";

/** The Job posting tab's posting, as saved with the application. */
export type PostingData = {
  text: string;
  /** The saved link to the posting, or "". */
  url: string;
  /** When it was pasted, e.g. "27 Sep". */
  pasted: string;
};

/** "jobs.ledgerly.com/senior-designer" for a link, without the scheme. */
function shortLink(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    return `${host}${pathname === "/" ? "" : pathname}`;
  } catch {
    return url;
  }
}

/**
 * The Job posting tab (APP-11), across the page: on the left, what the AI
 * should know for this job (APP-15), one free-text box it reads with the
 * profile and base resume whenever it writes or rewrites here; on the right,
 * the posting as pasted, whitespace kept, with a link to the original and
 * how the profile matches it, scrolling when it's long.
 */
export function PostingTab({
  applicationId,
  posting,
  match,
  requirements,
  onAddSkill,
  facts,
  setFacts,
}: {
  applicationId: string;
  posting: PostingData;
  match: Match | null;
  requirements: Requirement[];
  onAddSkill: (index: number, skill: string) => void;
  facts: FactItem[];
  setFacts: (change: (facts: FactItem[]) => FactItem[]) => void;
}) {
  const notesHint = useId();
  const saved = facts.map((fact) => fact.text.trim()).filter(Boolean).join("\n\n");
  const [draft, setDraft] = useState(saved);
  const [state, setState] = useState<"saved" | "saving" | "changed">("saved");
  const save = async () => {
    if (draft.trim() === saved) return setState("saved");
    setState("saving");
    const result = await saveApplicationNotes({ applicationId, text: draft });
    if (!result.ok) {
      setState("changed");
      return toast(result.error);
    }
    setFacts(() => result.data);
    setState("saved");
  };
  return (
    <div className="@container flex flex-1 flex-col overflow-auto bg-canvas px-10 pt-8 pb-16">
      <div className="mx-auto grid w-full max-w-[1400px] items-start gap-5 @min-[1000px]:grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
        <section
          aria-labelledby={`${notesHint}-title`}
          className="flex flex-col gap-3 rounded-panel border border-line-card bg-card px-[26px] py-6 @min-[1000px]:sticky @min-[1000px]:top-0"
        >
          <div className="flex flex-col gap-1.5">
            <h2 id={`${notesHint}-title`} className="text-[15px] font-medium">
              What the AI Should Know For This Job
            </h2>
            <p id={notesHint} className="text-sm text-pretty text-muted">
              Anything worth stressing or leaving out for this role. The AI uses it with your profile, your{" "}
              <Link href={sectionHref("facts")} className="text-muted underline underline-offset-2 hover:text-ink">
                Facts about me
              </Link>{" "}
              and your base resume the next time it writes or rewrites something here.
            </p>
          </div>
          <textarea
            aria-labelledby={`${notesHint}-title`}
            aria-describedby={notesHint}
            rows={10}
            maxLength={4000}
            value={draft}
            placeholder={"e.g. Lean on my design-system work at Acme.\nI met their design lead at Config last year.\nThey want hybrid, 3 days in the office."}
            onChange={(event) => {
              setDraft(event.target.value);
              setState("changed");
            }}
            onBlur={() => void save()}
            className="w-full resize-y rounded-control border border-line-input bg-input px-3 py-2.5 text-sm leading-normal placeholder:text-muted focus-visible:border-primary focus-visible:outline-offset-0"
          />
          <p role="status" className="text-meta text-muted">
            {state === "saving" ? "Saving…" : state === "changed" ? "Saves when you click away." : draft.trim() ? "Saved." : "Nothing yet."}
          </p>
        </section>

        <section aria-label="Job posting" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-meta text-muted">
            <span className="min-w-0">
              Job posting
              {posting.url && (
                <>
                  {" · "}
                  <a
                    href={posting.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-muted underline underline-offset-2 hover:text-ink"
                  >
                    {shortLink(posting.url)}
                    <span aria-hidden="true"> ↗</span>{" "}
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </>
              )}
            </span>
            <span>Pasted {posting.pasted}</span>
          </div>
          <div className="flex max-h-[calc(100vh-260px)] min-h-[420px] flex-col gap-[22px] overflow-y-auto rounded-panel border border-line-card bg-card px-[30px] py-7">
            {match && match.items.length > 0 && <MatchRows match={match} requirements={requirements} onAddSkill={onAddSkill} />}
            <div className={match && match.items.length > 0 ? "flex flex-col gap-2.5 border-t border-line pt-5" : "flex flex-col gap-2.5"}>
              <h2 className="text-[15px] font-medium">Original posting</h2>
              {posting.text.trim() ? (
                <p className="max-w-[90ch] text-[15px] leading-[1.7] whitespace-pre-wrap text-document">{posting.text}</p>
              ) : (
                <p className="text-sm text-muted">No posting was saved with this application.</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
