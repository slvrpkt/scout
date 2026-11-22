import { z } from "zod";

import { system, type Task } from "./prompt-parts";

export const NAME_TOPIC_VERSION = "name-topic@1";

const answerSchema = z.object({ topic: z.string() });

const INSTRUCTIONS = `You name what a resume suggestion is about, as JSON: the skill, tool, duty, document or credential it asks the candidate to add, in 2 to 6 words, e.g. "Kanban and flow-based delivery", "HIPAA / protected health information", "PMP certification". No sentence, no "the posting asks".`;

/** "Not true" on one suggestion: what it's about, to keep in Facts so it's never suggested again. */
export const nameTopic: Task<{ suggestion: string }, string> = async (provider, { suggestion }, { signal }) => {
  const answer = await provider.complete({
    system: system(INSTRUCTIONS),
    messages: [{ role: "user", content: suggestion }],
    schema: answerSchema,
    schemaName: "suggestion_topic",
    effort: "low",
    signal,
  });
  return { data: answer.topic.trim().replace(/[.\s]+$/, "").slice(0, 80), promptVersion: NAME_TOPIC_VERSION };
};
