// A minute's memory of Google Calendar, so the Dashboard opens in an instant
// on a second visit: the events Google listed, and when moved interviews were
// last pulled. Scout's own changes to the calendar, and a change of Google
// account, forget it. Kept on globalThis, so dev reloads keep one.

/** How long what Google answered is kept. */
export const CALENDAR_TTL_MS = 60_000;

type Kept<T> = { at: number; value: Promise<T> };

const state = ((globalThis as unknown as { calendarCache?: { lists: Map<string, Kept<unknown>>; pulledAt: number } }).calendarCache ??= {
  lists: new Map(),
  pulledAt: 0,
});

/** What `load` gives for `key`, kept for CALENDAR_TTL_MS; a failed answer isn't kept. */
export function keptFor<T>(key: string, load: () => Promise<T>): Promise<T> {
  const kept = state.lists.get(key) as Kept<T> | undefined;
  if (kept && Date.now() - kept.at < CALENDAR_TTL_MS) return kept.value;
  const value = load();
  state.lists.set(key, { at: Date.now(), value });
  value.catch(() => state.lists.get(key)?.value === value && state.lists.delete(key));
  return value;
}

/** Whether moved interviews are due to be pulled from Google again; true marks them pulled now. */
export function pullDue(): boolean {
  if (Date.now() - state.pulledAt < CALENDAR_TTL_MS) return false;
  state.pulledAt = Date.now();
  return true;
}

/** Forgets all of it: after Scout adds, moves or deletes an event, or Google is connected or disconnected. */
export function forgetCalendarCache(): void {
  state.lists.clear();
  state.pulledAt = 0;
}
