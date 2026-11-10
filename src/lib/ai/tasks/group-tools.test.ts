import { describe, expect, it, vi } from "vitest";

import { groupTools } from "./group-tools";

const options = { creativity: "BALANCED", strict: true, language: null } as never;

describe("groupTools", () => {
  it("sorts the tools asked about, reusing categories, and cleans what comes back", async () => {
    const complete = vi.fn(async () => ({ tools: [{ name: "Terraform", category: "Cloud & DevOps" }, { name: "Vitest", category: "Testing: unit" }, { name: "Made up", category: "Other" }] }));
    const { data } = await groupTools({ kind: "MOCK", model: "m", complete } as never, { toSort: ["Terraform", "Vitest"], categories: ["Cloud & DevOps"] }, options);
    expect(data).toEqual({ Terraform: "Cloud & DevOps", Vitest: "Testing unit" });
    expect((complete.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[0].content).toMatch(/Existing categories: Cloud & DevOps/);
  });

  it("asks nothing when there's nothing to sort", async () => {
    const complete = vi.fn();
    expect((await groupTools({ kind: "MOCK", model: "m", complete } as never, { toSort: [], categories: [] }, options)).data).toEqual({});
    expect(complete).not.toHaveBeenCalled();
  });
});
