import { describe, expect, it, vi } from "vitest";

import { groupSuggestions } from "./group-suggestions";

const options = { creativity: "BALANCED", strict: true, language: null } as const;
const model = (answer: unknown) => ({ kind: "MOCK", model: "m", complete: vi.fn(async () => answer) }) as never;

const items = [
  { applicationId: "acme", company: "Acme Health", text: "Name HIPAA in your Northwind bullet." },
  { applicationId: "globex", company: "Globex", text: "Mention PHI handling in your claims work." },
  { applicationId: "globex", company: "Globex", text: "Name the SELC documents you wrote." },
  { applicationId: "initech", company: "Initech", text: "Add Kanban if you used it." },
];
const roles = [{ id: "northwind", label: "Project Manager at Northwind Health" }];

describe("groupSuggestions", () => {
  it("keeps the topics two or more drafts raise, with the role they point to", async () => {
    const answer = {
      topics: [
        { topic: " HIPAA / protected health information ", members: [0, 1, 1, 9], roleId: "northwind", guess: " Handled PHI under HIPAA in claims EDI work. " },
        // One draft only: answered beside its own resume.
        { topic: "SELC documents", members: [2], roleId: null, guess: "" },
        // Not a role of the profile's.
        { topic: "Kanban", members: [3, 2], roleId: "made-up", guess: "" },
      ],
    };
    const { data } = await groupSuggestions(model(answer), { items, roles }, options);
    expect(data).toEqual([
      { topic: "HIPAA / protected health information", roleId: "northwind", guess: "Handled PHI under HIPAA in claims EDI work.", items: [items[0], items[1]], sameAs: null },
      { topic: "Kanban", roleId: null, guess: "", items: [items[3], items[2]], sameAs: null },
    ]);
  });

  it("says when a topic is one already decided, however it's worded, and only one that was", async () => {
    const answer = {
      topics: [
        { topic: "Jira / Confluence sprints and backlogs", members: [0, 1], roleId: null, guess: "", sameAs: "Jira and Confluence" },
        { topic: "Kanban", members: [3, 2], roleId: null, guess: "", sameAs: "Something never decided" },
      ],
    };
    const provider = model(answer);
    const { data } = await groupSuggestions(provider, { items, roles, decided: ["Jira and Confluence"] }, options);
    expect(data.map((topic) => topic.sameAs)).toEqual(["Jira and Confluence", null]);
    expect(JSON.stringify((provider as unknown as { complete: ReturnType<typeof vi.fn> }).complete.mock.calls[0])).toContain("Topics already decided");
  });

  it("doesn't ask the AI with fewer than two drafts", async () => {
    const provider = model({ topics: [] });
    expect((await groupSuggestions(provider, { items: items.slice(0, 1), roles }, options)).data).toEqual([]);
    expect((provider as unknown as { complete: ReturnType<typeof vi.fn> }).complete).not.toHaveBeenCalled();
  });
});
