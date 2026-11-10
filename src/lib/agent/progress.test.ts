import { describe, expect, it } from "vitest";

import { progressMessage } from "./progress";

const now = new Date("2026-11-07T13:30:00Z");
const base = { now, timeZone: "America/New_York", searching: false, scoreAt: null, batchAt: null };

describe("progressMessage", () => {
  it("says nothing when the agent is idle", () => {
    expect(progressMessage(base)).toBeNull();
  });

  it("gives a time to check back while searching", () => {
    expect(progressMessage({ ...base, searching: true, scoreAt: "2026-11-07T14:00:00.000Z" })).toBe("Scout is looking for new jobs. Check back around 9:20 AM for the new batch and its scores.");
  });

  it("says when scoring starts", () => {
    expect(progressMessage({ ...base, scoreAt: "2026-11-07T14:00:00.000Z" })).toContain("Scoring starts around 9:00 AM, so check back around 9:20 AM");
  });

  it("gives a later time when a batch runs long", () => {
    expect(progressMessage({ ...base, batchAt: "2026-11-07T12:00:00.000Z" })).toContain("8:35 AM");
  });
});
