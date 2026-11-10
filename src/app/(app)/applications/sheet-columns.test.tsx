import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ApplicationRow } from "@/lib/applications-data";
import { DEFAULT_SORT } from "@/lib/applications-list";
import { SHEET_COLUMNS, sheetCsv } from "@/lib/applications-sheet-columns";

import { Table } from "./table";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./actions", () => ({}));

const row = (extra: Partial<ApplicationRow> = {}): ApplicationRow => ({
  id: "a",
  company: "Ledgerly",
  role: "Senior Product Designer",
  location: "Amsterdam",
  mode: "Hybrid",
  status: "SENT",
  archived: false,
  deadline: "3 Dec 2026",
  match: { hit: 5, total: 7 },
  sent: "20 Sep 2026",
  updated: "26 Sep 2026",
  updatedAt: 0,
  resume: { href: "/api/pdf", sent: true },
  posted: "14 Sep 2026",
  created: "15 Sep 2026",
  employer: { type: "GOVERNMENT", chosen: null, auto: true },
  latestEvent: null,
  appliedVia: { value: null, auto: true },
  thingsToNote: "",
  salary: "",
  postingUrl: "",
  hasPosting: false,
  driveLinks: { documents: null, posting: null },
  manual: true,
  ...extra,
});

describe("the Job application log's Google Sheet", () => {
  it("has every column the table has, in its order", () => {
    render(<Table rows={[]} sort={DEFAULT_SORT} onSort={vi.fn()} onMove={vi.fn()} />);
    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent!.replace(/[↑↓]/g, "").trim())
      .filter((label) => label && label !== "Actions");
    const labels = SHEET_COLUMNS.map((column) => column.label);
    expect(labels.filter((label) => headers.includes(label))).toEqual(headers);
    // The role's link and labels (source, employer, posted, apply by) get columns of their own.
    expect(labels.filter((label) => !headers.includes(label))).toEqual(["Posting Link", "Source", "Employer", "Posted", "Apply By"]);
  });

  it("writes a row per application as the table shows it, quoted where needed and never as a formula", () => {
    const csv = sheetCsv([
      row({
        latestEvent: { kind: "CALL", body: "Talked to Sam, next round Monday" },
        salary: "$110,000–$130,000",
        postingUrl: "https://jobs.example.com/1",
        appliedVia: { value: "Greenhouse", auto: true },
        thingsToNote: "Hybrid 2 days",
        driveLinks: { documents: "https://drive.google.com/file/d/r/view", posting: "https://drive.google.com/file/d/p/view" },
      }),
      row({ manual: false, company: 'Acme, "Labs"', role: "=HYPERLINK(1)", archived: true, status: "REJECTED", employer: { type: null, chosen: null, auto: true }, posted: null, deadline: null, match: null, location: "", resume: null }),
    ]);
    expect(csv.split("\r\n")).toEqual([
      "Company,Role,Salary,Posting Link,Source,Employer,Posted,Apply By,Location,Things To Note,Applied Using,Status,Match,Applied,Resume & Cover Letter,Job Description,Activity,Updated",
      'Ledgerly,Senior Product Designer,"$110,000–$130,000",https://jobs.example.com/1,Manual,Government,14 Sep 2026,3 Dec 2026,Amsterdam,Hybrid 2 days,Greenhouse,Applied,5/7,20 Sep 2026,https://drive.google.com/file/d/r/view,https://drive.google.com/file/d/p/view,"Call: Talked to Sam, next round Monday",26 Sep 2026',
      `"Acme, ""Labs""",'=HYPERLINK(1),Not listed,,Agentic,,Created 15 Sep 2026,,Not given,,,Rejected (Archived),Not matched,20 Sep 2026,Not in Drive yet,Not in Drive yet,,26 Sep 2026`,
    ]);
  });

  it("is just the header row while there's nothing to list", () => {
    expect(sheetCsv([])).toBe(
      "Company,Role,Salary,Posting Link,Source,Employer,Posted,Apply By,Location,Things To Note,Applied Using,Status,Match,Applied,Resume & Cover Letter,Job Description,Activity,Updated",
    );
  });
});
