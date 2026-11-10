// Applied Using on the Job application log: where the application went in.
// Scout guesses it from where the posting came from (the job source's
// "via", then the posting link), never storing the guess; the user's choice
// replaces it, since a job found on LinkedIn may be applied to on the
// company's own site.

/** The platforms the Applied Using menu offers, in its order. */
export const APPLIED_VIA_OPTIONS = [
  "LinkedIn",
  "Indeed",
  "Company Website",
  "Greenhouse",
  "Lever",
  "Workday",
  "Ashby",
  "iCIMS",
  "SmartRecruiters",
  "Jobvite",
  "Workable",
  "BambooHR",
  "Glassdoor",
  "ZipRecruiter",
  "Wellfound",
  "USAJOBS",
  "hiring.cafe",
  "Referral",
  "Recruiter",
  "Email",
  "Other",
] as const;

/** Hosts and the platform each one is, matched on the host and its subdomains. */
const HOSTS: [string, string][] = [
  ["linkedin.com", "LinkedIn"],
  ["indeed.com", "Indeed"],
  ["glassdoor.com", "Glassdoor"],
  ["ziprecruiter.com", "ZipRecruiter"],
  ["wellfound.com", "Wellfound"],
  ["angel.co", "Wellfound"],
  ["usajobs.gov", "USAJOBS"],
  ["hiring.cafe", "hiring.cafe"],
  ["greenhouse.io", "Greenhouse"],
  ["lever.co", "Lever"],
  ["myworkdayjobs.com", "Workday"],
  ["myworkday.com", "Workday"],
  ["workday.com", "Workday"],
  ["ashbyhq.com", "Ashby"],
  ["smartrecruiters.com", "SmartRecruiters"],
  ["icims.com", "iCIMS"],
  ["jobvite.com", "Jobvite"],
  ["workable.com", "Workable"],
  ["bamboohr.com", "BambooHR"],
];

/** The platform a "via" or a link names, if it's one Scout knows. */
function known(text: string): string | null {
  const lower = text.trim().toLowerCase();
  if (!lower) return null;
  const option = APPLIED_VIA_OPTIONS.find((entry) => entry.toLowerCase() === lower);
  if (option) return option;
  const host = hostOf(lower) ?? lower.replace(/\s+/g, "");
  return HOSTS.find(([domain]) => host === domain || host.endsWith(`.${domain}`) || host === domain.split(".")[0])?.[1] ?? null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Scout's guess: the job source's "via" (e.g. "LinkedIn"), else the
 * platform of the posting link, else Company Website for any other link;
 * null with nothing to go on.
 */
export function guessAppliedVia({ via, postingUrl }: { via?: string | null; postingUrl: string }): string | null {
  const fromVia = via ? known(via) : null;
  if (fromVia) return fromVia;
  const host = hostOf(postingUrl);
  if (!host) return null;
  return known(postingUrl) ?? "Company Website";
}
