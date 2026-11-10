// Company searches: a job agent search's companies (up to MAX_SEARCH_COMPANIES)
// or Manual job search's Company box. The company goes into the search, and
// what comes back is kept only when its employer is that company, since a
// source's matching is loose ("Accenture" can bring in its clients' jobs).

/** How many companies a job agent search may look for. */
export const MAX_SEARCH_COMPANIES = 10;

// Legal forms and filler that don't tell companies apart.
const NOISE = new Set(["inc", "incorporated", "llc", "llp", "lp", "ltd", "limited", "corp", "corporation", "co", "company", "plc", "gmbh", "ag", "sa", "the", "group", "holding", "holdings"]);

/** A company's name as words to compare: lower case, without punctuation or legal forms. */
export function companyWords(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !NOISE.has(word));
}

/**
 * Whether a posting's employer is the company asked for: its words start the
 * employer's name, or appear in it in a row. "Accenture" matches "Accenture
 * Federal Services" and "Leidos" matches "Leidos Holdings, Inc."; "Ernst" alone
 * doesn't match "Ernst & Young" only by luck of a shared word elsewhere.
 */
export function employerMatches(employer: string, company: string): boolean {
  const wanted = companyWords(company);
  const actual = companyWords(employer);
  if (wanted.length === 0 || actual.length === 0) return false;
  for (let start = 0; start + wanted.length <= actual.length; start += 1) {
    if (wanted.every((word, index) => actual[start + index] === word)) return true;
  }
  // Written together or apart ("Booz Allen", "BoozAllen"), but whole words only: "Meta" isn't "Metaphor".
  const joined = wanted.join("");
  for (let start = 0; start < actual.length; start += 1) {
    let run = "";
    for (let end = start; end < actual.length && run.length < joined.length; end += 1) {
      run += actual[end];
      if (run === joined) return true;
    }
  }
  return false;
}

/** A company search's text for sources that read the company from the query: "Project Manager at Accenture". */
export const withCompany = (keywords: string, company: string | undefined) =>
  company?.trim() ? `${keywords.trim() || "jobs"} at ${company.trim()}` : keywords;

/** The company a job title names after "at", like "Project Manager at Leidos"; null when it doesn't. */
export function companyInTitle(title: string): string | null {
  const match = /\s+at\s+([A-Za-z0-9&.'’ -]{2,60})$/i.exec(title.trim());
  return match ? match[1].trim() : null;
}
