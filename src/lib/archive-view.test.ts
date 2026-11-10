import { describe, expect, it } from "vitest";

import type { ArchiveRow } from "./archive-data";
import { filterArchive, NO_ARCHIVE_FILTERS, sortArchive } from "./archive-view";

const row = (id: string, patch: Partial<ArchiveRow> = {}): ArchiveRow => ({
  kind: "posting",
  id,
  archivedAt: "2026-11-08T12:00:00.000Z",
  title: `Job ${id}`,
  company: `Company ${id}`,
  location: "Rockville, MD",
  salary: "",
  pay: null,
  score: null,
  why: "title",
  note: "",
  foundBy: null,
  href: "",
  ...patch,
});
const now = new Date(2026, 10, 8, 18);

describe("the Archive's filters", () => {
  const rows = [
    row("a", { title: "Director of Projects", note: "Skipped by its title: “director”", archivedAt: new Date(2026, 10, 8, 9).toISOString() }),
    row("b", { why: "word", company: "Acme", pay: 140_000, score: null, archivedAt: new Date(2026, 10, 3, 9).toISOString() }),
    row("c", { kind: "application", why: "you", score: 82, pay: 95_000, location: "Remote", archivedAt: new Date(2026, 9, 20, 9).toISOString() }),
  ];
  const ids = (filters: Partial<typeof NO_ARCHIVE_FILTERS>) => filterArchive(rows, { ...NO_ARCHIVE_FILTERS, ...filters }, now).map((entry) => entry.id);

  it("filters by when it was archived: today, this week, this month, or between dates", () => {
    expect(ids({ when: "today" })).toEqual(["a"]);
    expect(ids({ when: "week" })).toEqual(["a", "b"]);
    expect(ids({ when: "month" })).toEqual(["a", "b"]);
    expect(ids({ when: "range", from: "2026-10-01", to: "2026-11-03" })).toEqual(["b", "c"]);
  });

  it("filters by why, type, title (or the word that archived it), company, location, pay and score", () => {
    expect(ids({ why: "word" })).toEqual(["b"]);
    expect(ids({ kind: "application" })).toEqual(["c"]);
    expect(ids({ title: "director" })).toEqual(["a"]);
    expect(ids({ company: "acme" })).toEqual(["b"]);
    expect(ids({ location: "remote" })).toEqual(["c"]);
    expect(ids({ minPay: 100_000 })).toEqual(["b"]);
    expect(ids({ minScore: 80 })).toEqual(["c"]);
  });

  it("sorts any column, numbers high first and words A to Z first, reversed on request, the unknown last", () => {
    expect(sortArchive(rows, { key: "pay", reversed: false }).map((entry) => entry.id)).toEqual(["b", "c", "a"]);
    expect(sortArchive(rows, { key: "pay", reversed: true }).map((entry) => entry.id)).toEqual(["c", "b", "a"]);
    expect(sortArchive(rows, { key: "company", reversed: false }).map((entry) => entry.id)).toEqual(["b", "a", "c"]);
    expect(sortArchive(rows, { key: "archivedAt", reversed: false }).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });
});
