// The Location filter on Agentic job search and Saved for later: Remote, each
// state, then each city, read from where the posting says the job is.

type Placed = { place: string; remote: boolean | null };

/** Each name and how many times it comes up, the most first, then by name. */
export function countsOf(names: readonly string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** "Reston, VA, US" → its state ("VA") and its city ("Reston, VA"); remote jobs as Remote. */
function placeParts(job: Placed): { state: string | null; city: string | null; remote: boolean } {
  const parts = job.place.split(",").map((part) => part.trim()).filter(Boolean);
  // The country at the end, when there is one, isn't a state.
  if (parts.length >= 3) parts.pop();
  const state = parts.length >= 2 ? parts[parts.length - 1] : null;
  const city = parts.length >= 2 ? `${parts[0]}, ${state}` : (parts[0] ?? null);
  return { state, city, remote: job.remote === true };
}

/** The Location filter's choices: Remote, each state, then each city, with how many jobs each. */
export function placeChoices(jobs: readonly Placed[]): { value: string; label: string; count: number }[] {
  const all = jobs.map(placeParts);
  const remote = all.filter((place) => place.remote).length;
  const states = countsOf(all.flatMap((place) => (place.state ? [place.state] : [])));
  const cities = countsOf(all.flatMap((place) => (place.city ? [place.city] : [])));
  return [
    ...(remote > 0 ? [{ value: "remote", label: "Remote", count: remote }] : []),
    ...states.map(([state, count]) => ({ value: `state:${state}`, label: `All of ${state}`, count })),
    ...cities.map(([city, count]) => ({ value: `city:${city}`, label: city, count })),
  ];
}

/** Whether a job is at the place chosen in the Location filter. */
export function atPlace(job: Placed, where: string): boolean {
  if (!where) return true;
  const place = placeParts(job);
  if (where === "remote") return place.remote;
  if (where.startsWith("state:")) return place.state === where.slice("state:".length);
  if (where.startsWith("city:")) return place.city === where.slice("city:".length);
  return true;
}

/** The Score filter: each choice is a floor, so "80+" keeps the 90s too. Under 60 is the one band. */
export const SCORE_RANGES = [
  { value: "90", label: "90+", low: 90, high: 100 },
  { value: "80", label: "80+", low: 80, high: 100 },
  { value: "70", label: "70+", low: 70, high: 100 },
  { value: "60", label: "60+", low: 60, high: 100 },
  { value: "0", label: "Under 60", low: 0, high: 59 },
] as const;

/** Whether a score is in the chosen range; any score when none is chosen. A job not scored yet only shows without one. */
export function inScoreRange(score: number | null, chosen: string): boolean {
  const range = SCORE_RANGES.find((choice) => choice.value === chosen);
  if (!range) return true;
  return score !== null && score >= range.low && score <= range.high;
}
