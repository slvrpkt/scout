import { Card } from "@/components/ui/card";
import { centersInUse, dollars, FREE_CENTERS, overLimitText, PRICES_AS_OF } from "@/lib/cost-rates";
import { costLimitsPassed, COST_PERIODS, loadCosts } from "@/lib/costs";
import { formatDate } from "@/lib/dates";
import { loadSettings } from "@/lib/settings-data";
import { loadAiConfig } from "@/lib/ai/config";
import { loadJobSearchConfig } from "@/lib/job-search/config";
import { loadScoringConfig } from "@/lib/scoring/config";
import { lastKnownTimeZone } from "@/lib/time-zone";

import { CostLimitsForm } from "../costs/cost-limits-form";
import { CostTable } from "../costs/cost-table";

const WHAT: Record<string, string> = {
  posting_score: "Scoring jobs",
  tailored_resume: "Writing tailored resumes",
  cover_letter: "Writing cover letters",
  extracted_posting: "Reading postings",
  requirement_matches: "Matching requirements",
  condensed_bullets: "Shortening bullets to fit",
  resume_suggestions: "Suggestions",
  base_summary: "Base resume summary",
  application_email: "Writing application emails",
  classified_reply: "Reading replies",
  reply_draft: "Drafting replies",
  refinement: "Chat edits",
  new_text: "Rewriting a section",
  extracted_profile: "Reading your resume file",
  proofread_profile: "Proofreading your profile",
};
const labelOf = (kind: string) => WHAT[kind] ?? kind.replaceAll("_", " ").replace(/^./, (first) => first.toUpperCase());

/** Settings → Estimated cost: what Scout's outside services have cost, by service in use, with limits on each that costs anything. */
export async function CostsSection() {
  const now = new Date();
  const [settings, timeZone, ai, search, scoring] = await Promise.all([loadSettings(), lastKnownTimeZone(), loadAiConfig().catch(() => null), loadJobSearchConfig(), loadScoringConfig()]);
  const [costs, passed] = await Promise.all([loadCosts(now, timeZone), costLimitsPassed(settings.costLimits, now, timeZone)]);
  const provider = ai?.provider ?? null;
  const chosen = [provider === "LOCAL" || provider === "LMSTUDIO" ? ("LOCAL_AI" as const) : provider, search.source, scoring.scorer === "JEV" ? ("TYPESAFE" as const) : null];
  const centers = centersInUse(chosen, costs.periods.all);
  return (
    <>
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted">What Scout has spent on outside services, worked out from each request. Each service&apos;s own bill has the last word.</p>
        <div role="note" className="flex flex-col gap-1.5 rounded-card border border-warning bg-warning-surface px-5 py-4 text-sm text-warning">
          <span className="font-medium">These are estimates, not your bill</span>
          <span>
            Scout works them out from each provider&apos;s published prices as of {PRICES_AS_OF} and the requests it made. Prices change, providers round and
            bill differently, and some use isn&apos;t seen by Scout at all. Always check your actual usage and charges in your account with each provider
            (Anthropic, JSearch and the others you use). This page isn&apos;t a billing system; it&apos;s here to help you keep an eye on spending.
          </span>
        </div>
        {passed.map((over) => (
          <p key={`${over.center}${over.period}`} role="alert" className="rounded-card bg-warning-surface px-5 py-3 text-sm text-warning">
            {overLimitText(over)} It carries on when the period ends, or as soon as you raise the limit.
          </p>
        ))}
        <CostTable periods={COST_PERIODS} centers={centers} amounts={costs.periods} tracking={costs.since ? `Tracking since ${formatDate(costs.since)}; anything spent before that isn't counted.` : "Nothing yet: tracking starts with the next search or AI request."} />
        {costs.uses.length > 0 && (
          <Card padding="none" className="px-6 py-5">
            <h2 className="pb-2 text-[15px] font-medium">What the AI went on this month</h2>
            <ul className="flex flex-col text-sm">
              {costs.uses.map(({ kind, amount }) => (
                <li key={kind} className="flex justify-between border-t border-line py-2">
                  <span>{labelOf(kind)}</span>
                  <span className="tabular-nums">{dollars(amount)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <CostLimitsForm centers={centers.filter((center) => !FREE_CENTERS.includes(center))} limits={settings.costLimits} />
      </div>
    </>
  );
}
