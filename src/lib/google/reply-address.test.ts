import { describe, expect, it } from "vitest";

import { isNoReply } from "./reply-address";

describe("isNoReply", () => {
  it("knows addresses nobody reads", () => {
    for (const address of ["noreply@acme.example", "no-reply@greenhouse.io", "do-not-reply@workday.com", "donotreply@acme.example", "notifications@acme.example"]) expect(isNoReply(address)).toBe(true);
  });

  it("leaves people and shared inboxes alone", () => {
    for (const address of ["jobs@acme.example", "noah.reply@acme.example", "careers@acme.example"]) expect(isNoReply(address)).toBe(false);
  });
});
