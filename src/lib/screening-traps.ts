// Resume screening traps: words a posting lists as requirements that aren't
// real technologies, certifications or methods (a "Cribbage programming
// language"), planted so an employer's hiring system can reject any resume
// that repeats them, since a tool that copies the posting's words would.
// The AI notes them when it reads the posting; they're shown as a warning,
// and never written into a tailored resume or cover letter.

/** A word the posting may have planted, and why it looks planted. */
export type ScreeningTrap = { term: string; why: string };

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Text without a trap term, along with the comma or "and"/"or" that joined it to its neighbours. */
function withoutTerm(text: string, term: string): string {
  const word = `(?<![\\w+#])${escape(term.trim()).replace(/\s+/g, "\\s+")}(?![\\w+#])`;
  return (
    text
      // "A, Cribbage, B" and "A, Cribbage" → "A, B" and "A"
      .replace(new RegExp(`\\s*[,;]\\s*${word}`, "gi"), "")
      // "Cribbage, A" → "A"
      .replace(new RegExp(`${word}\\s*[,;]\\s*`, "gi"), "")
      // "A and Cribbage" → "A"; "Cribbage or A" → "A"
      .replace(new RegExp(`\\s+(?:and|or|&)\\s+${word}`, "gi"), "")
      .replace(new RegExp(`${word}\\s+(?:and|or|&)\\s+`, "gi"), "")
      // Anywhere else, the word alone.
      .replace(new RegExp(`\\s*${word}`, "gi"), "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/ +([.,;:)])/g, "$1")
      .replace(/\( *\)/g, "")
  );
}

/** Whether `text` uses any of the trap terms. */
export function mentionsTrap(text: string, traps: readonly ScreeningTrap[]): boolean {
  return traps.some(({ term }) => term.trim() && new RegExp(`(?<![\\w+#])${escape(term.trim()).replace(/\s+/g, "\\s+")}(?![\\w+#])`, "i").test(text));
}

/** Text with every trap term taken out. */
export function stripTraps(text: string, traps: readonly ScreeningTrap[]): string {
  return traps.reduce((current, { term }) => (term.trim() ? withoutTerm(current, term) : current), text);
}

/** For a prompt: the words never to write, or nothing when the posting has none. */
export function trapsForPrompt(traps: readonly ScreeningTrap[]): string {
  if (traps.length === 0) return "";
  return `The posting lists these as requirements, but they aren't real technologies, certifications or methods: likely screening traps planted to catch AI-written resumes. Never write them, or anything pretending to be them, even where the posting asks for them:\n${traps.map(({ term }) => `- ${term}`).join("\n")}`;
}
