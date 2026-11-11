// Job boards often send only the start of a posting. A description this
// short can't tailor a resume well, so Scout says so: on the application's
// resume and posting tabs, and on the job agent's cards. The agent also
// holds its automatic drafts for such postings (agent/draft.ts).

/** Under this many characters, a job description looks cut short. */
export const SHORT_POSTING_CHARS = 1200;

/** Whether a job description looks cut short; an empty one is a different problem. */
export function looksCutShort(text: string): boolean {
  const length = text.trim().length;
  return length > 0 && length < SHORT_POSTING_CHARS;
}

/** The warning, in a line. */
export function shortPostingWarning(text: string): string {
  return `Warning: this job description seems too short, only ${text.trim().length.toLocaleString("en-US")} characters.`;
}
