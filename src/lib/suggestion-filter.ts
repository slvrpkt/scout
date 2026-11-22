// What a resume suggestion is never about, checked in code after the AI,
// which doesn't always keep to its instructions: logistics that aren't
// resume content, generic soft skills to "name outright", and nice-to-haves
// the candidate can ignore. What's left is worth the candidate's minute.

const NOT_WORTH_RAISING = [
  // Logistics.
  /\b(commut\w*|relocat\w*|travel(ing|ling)?\b|on-?site availability|start date|notice period|salary|work hours|shift)\b/i,
  // Generic soft skills.
  /\b(interpersonal|communication skills|verbal\/written|written and verbal|attention to detail|adaptab\w*|problem[- ]solving|customer service|team ?player|organizational skills|fast-paced)\b/i,
  // Nice-to-haves the candidate can ignore.
  /\b(as a plus|nice to have|if not, no action|no action is needed)\b/i,
];

/** Whether a suggestion is one the candidate should spend time on. */
export const worthRaising = (idea: string): boolean => !NOT_WORTH_RAISING.some((pattern) => pattern.test(idea));

/** The AI's suggestions, trimmed, without the kinds never worth raising, at most five. */
export const keptSuggestions = (ideas: readonly string[]): string[] =>
  ideas
    .map((idea) => idea.trim().slice(0, 400))
    .filter((idea) => idea && worthRaising(idea))
    .slice(0, 5);
