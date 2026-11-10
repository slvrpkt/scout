import { EmployerType } from "@/generated/prisma/enums";

// Who the employer is, for the applications list's label: Government,
// Startup, or nothing for a private company. Until the user sets it,
// Scout guesses from the company's name, the posting's address and text,
// and whether it came from Startups; a guess it isn't sure of is no label.

/** Web addresses of governments and their job sites. */
const GOVERNMENT_HOSTS = /(^|\.)(gov|mil|gov\.[a-z]{2}|gc\.ca|gouv\.fr|bund\.de|overheid\.nl|usajobs\.gov|governmentjobs\.com|jobs\.ca\.gov|civilservicejobs\.service\.gov\.uk)$/i;

/** Names public bodies go by. */
const GOVERNMENT_NAMES =
  /\b(city of|county|state of|commonwealth of|department of|dept\.? of|ministry|ministerie|federal|government|gouvernement|municipality|municipal|gemeente|provincie|rijksoverheid|(city|county|district|town) council|public schools?|school district|police department|sheriff|fire department|national guard|u\.?s\.? (army|navy|air force)|(transit|port|housing|water) authority|bureau of|office of the)\b/i;

/** What a posting from a public body says about itself. */
const GOVERNMENT_TEXT = /\b(government agency|federal agency|state agency|public sector|civil service|security clearance required|usajobs|gs-\d{1,2}\b|veterans'? preference)\b/i;

/** What a startup says about itself. */
const STARTUP_TEXT =
  /\b(start-?up|seed[- ]stage|seed round|pre-seed|series [abc]\b|series [abc] funded|founding (engineer|designer|team|member)|early[- ]stage|venture[- ]backed|y ?combinator|\byc [wsf]\d{2}\b)\b/i;

export type EmployerGuess = { company: string; postingUrl: string; postingText: string; fromStartups: boolean };

const host = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/** Scout's guess: Government or Startup when the signs are clear, otherwise null (a private company, or unsure). */
export function guessEmployerType({ company, postingUrl, postingText, fromStartups }: EmployerGuess): EmployerType | null {
  if (GOVERNMENT_HOSTS.test(host(postingUrl)) || GOVERNMENT_NAMES.test(company) || GOVERNMENT_TEXT.test(postingText)) return EmployerType.GOVERNMENT;
  if (fromStartups || STARTUP_TEXT.test(postingText)) return EmployerType.STARTUP;
  return null;
}

/** The label to show: the user's choice (Private shows none), else the guess. */
export function employerLabel(chosen: EmployerType | null, guess: EmployerType | null): { type: EmployerType | null; auto: boolean } {
  if (chosen) return { type: chosen === EmployerType.PRIVATE ? null : chosen, auto: false };
  return { type: guess, auto: true };
}

export const EMPLOYER_LABELS: Record<EmployerType, string> = {
  [EmployerType.GOVERNMENT]: "Government",
  [EmployerType.STARTUP]: "Startup",
  [EmployerType.PRIVATE]: "Private company",
};
