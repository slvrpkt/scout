// How a posting is applied to, read from its link: a known hiring tool or job
// board by name, otherwise the employer's own website. No request is made.

/** Hosts, matched at the end of the name, of the tools and boards people apply through. */
const PLACES: readonly (readonly [host: string, name: string])[] = [
  ["linkedin.com", "LinkedIn"],
  ["greenhouse.io", "Greenhouse"],
  ["lever.co", "Lever"],
  ["myworkdayjobs.com", "Workday"],
  ["myworkdaysite.com", "Workday"],
  ["ashbyhq.com", "Ashby"],
  ["smartrecruiters.com", "SmartRecruiters"],
  ["icims.com", "iCIMS"],
  ["taleo.net", "Taleo"],
  ["jobvite.com", "Jobvite"],
  ["bamboohr.com", "BambooHR"],
  ["workable.com", "Workable"],
  ["successfactors.com", "SuccessFactors"],
  ["adp.com", "ADP"],
  ["paylocity.com", "Paylocity"],
  ["indeed.com", "Indeed"],
  ["glassdoor.com", "Glassdoor"],
  ["ziprecruiter.com", "ZipRecruiter"],
  ["monster.com", "Monster"],
];

/** "Apply via Greenhouse", or on the company's website; null without a usable link. */
export function howToApply(link: string): { label: string; url: string } | null {
  let host: string;
  try {
    const url = new URL(link);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    host = url.hostname.toLowerCase();
  } catch {
    return null;
  }
  const place = PLACES.find(([name]) => host === name || host.endsWith(`.${name}`));
  return { label: place ? `Apply via ${place[1]}` : "Apply on the company's website", url: link };
}
