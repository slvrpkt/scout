import { describe, expect, it } from "vitest";

import { activityTimeline } from "./activity";

const at = (day: number, hour = 10) => new Date(Date.UTC(2026, 9, day, hour));
const timeZone = "UTC";

describe("activityTimeline (E8-9, application history)", () => {
  it("merges entries and status changes by when they happened, newest first, with the creation last", () => {
    const timeline = activityTimeline({
      notes: [
        { id: "n1", body: "Called John.", kind: "CALL", at: at(3, 15), createdAt: at(4), updatedAt: at(4) },
        { id: "n2", body: "Sent a thank-you.", createdAt: at(1), updatedAt: at(2) },
      ],
      events: [
        { id: "e1", to: "SENT", at: at(1, 9) },
        { id: "e2", to: "INTERVIEW", at: at(3, 9) },
      ],
      createdAt: at(1, 9),
      timeZone,
      now: at(5),
    });
    expect(timeline).toMatchObject([
      { kind: "note", id: "n1", noteKind: "CALL", body: "Called John.", date: "Sat 3 Oct, 15:00", at: at(3, 15).toISOString(), edited: false },
      { kind: "status", id: "e2", status: "INTERVIEW", date: "Sat 3 Oct, 09:00", sent: [] },
      { kind: "note", id: "n2", noteKind: "NOTE", body: "Sent a thank-you.", date: "Thu 1 Oct, 10:00", at: at(1).toISOString(), edited: true },
      { kind: "status", id: "e1", status: "SENT", date: "Thu 1 Oct, 09:00", sent: [] },
      { kind: "created", id: "created", date: "Thu 1 Oct, 09:00" },
    ]);
  });

  it("puts what was sent under the change that sent it, and a send by hand on its own", () => {
    const timeline = activityTimeline({
      notes: [],
      events: [{ id: "e1", to: "SENT", at: at(1, 9) }],
      sentDocuments: [
        { id: "s2", kind: "COVER_LETTER", eventId: "e1", sentAt: at(1, 9) },
        { id: "s1", kind: "RESUME", eventId: "e1", sentAt: at(1, 9) },
        { id: "s3", kind: "RESUME", eventId: null, sentAt: at(2, 14) },
      ],
      createdAt: at(1, 8),
      timeZone,
      now: at(5),
    });
    expect(timeline).toMatchObject([
      { kind: "sent", id: "s3", date: "Fri 2 Oct, 14:00", sent: [{ id: "s3", kind: "RESUME", label: "Resume" }] },
      {
        kind: "status",
        id: "e1",
        status: "SENT",
        date: "Thu 1 Oct, 09:00",
        sent: [
          { id: "s1", kind: "RESUME", label: "Resume" },
          { id: "s2", kind: "COVER_LETTER", label: "Cover letter" },
        ],
      },
      { kind: "created", id: "created", date: "Thu 1 Oct, 08:00" },
    ]);
  });

  it("adds the year to dates from another year", () => {
    const [created] = activityTimeline({ notes: [], events: [], createdAt: new Date(Date.UTC(2025, 11, 30, 12)), timeZone, now: at(5) });
    expect(created).toMatchObject({ kind: "created", id: "created", date: "Tue 30 Dec 2025, 12:00" });
  });
});
