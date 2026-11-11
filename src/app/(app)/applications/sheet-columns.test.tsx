import { render, screen } from "@testing-library/react";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import type { ApplicationRow } from "@/lib/applications-data";
import { DEFAULT_SORT } from "@/lib/applications-list";
import { SHEET_COLUMNS, sheetLocation, sheetTable, sheetXlsx } from "@/lib/applications-sheet-columns";

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

const HEADER = [
  "Company",
  "Role",
  "Salary",
  "Posting Link",
  "Source",
  "Employer",
  "Posted",
  "Apply By",
  "Location",
  "Things To Note",
  "Applied Using",
  "Status",
  "Applied",
  "Resume & Cover Letter",
  "Job Description",
  "Activity",
  "Updated",
];

describe("the Job application log's Google Sheet", () => {
  it("has every column the table has, in its order, but Match", () => {
    render(<Table rows={[]} sort={DEFAULT_SORT} onSort={vi.fn()} onMove={vi.fn()} />);
    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent!.replace(/[↑↓]/g, "").trim())
      .filter((label) => label && label !== "Actions");
    const labels = SHEET_COLUMNS.map((column) => column.label);
    expect(labels.filter((label) => headers.includes(label))).toEqual(headers.filter((label) => label !== "Match"));
    // The role's link and labels (source, employer, posted, apply by) get columns of their own.
    expect(labels.filter((label) => !headers.includes(label))).toEqual(["Posting Link", "Source", "Employer", "Posted", "Apply By"]);
  });

  it("writes a row per application as the table shows it, links as Click here", () => {
    const table = sheetTable([
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
    expect(table.map((cells) => cells.map((cell) => cell.text))).toEqual([
      HEADER,
      ["Ledgerly", "Senior Product Designer", "$110,000–$130,000", "Click here", "Manual", "Government", "14 Sep 2026", "3 Dec 2026", "Amsterdam", "Hybrid 2 days", "Greenhouse", "Applied", "20 Sep 2026", "Click here", "Click here", "Call: Talked to Sam, next round Monday", "26 Sep 2026"],
      ['Acme, "Labs"', "=HYPERLINK(1)", "Not listed", "", "Agentic", "", "Created 15 Sep 2026", "", "Not given", "", "", "Rejected (Archived)", "20 Sep 2026", "Not in Drive yet", "Not in Drive yet", "", "26 Sep 2026"],
    ]);
    expect(table[1].filter((cell) => cell.link).map((cell) => cell.link)).toEqual([
      "https://jobs.example.com/1",
      "https://drive.google.com/file/d/r/view",
      "https://drive.google.com/file/d/p/view",
    ]);
  });

  it("says Remote for a remote job, not a vague place", () => {
    expect(sheetLocation({ location: "Anywhere", mode: "Remote" })).toBe("Remote");
    expect(sheetLocation({ location: "", mode: "Fully remote" })).toBe("Remote");
    expect(sheetLocation({ location: "Columbia, MD", mode: "Remote" })).toBe("Remote · Columbia, MD");
    expect(sheetLocation({ location: "Columbia, MD", mode: "Hybrid" })).toBe("Columbia, MD");
  });

  it("is an Excel file: the header bold white on blue and frozen, links as formulas, the rest wrapped, text never a formula", () => {
    const files = unzipSync(sheetXlsx([row({ role: "=HYPERLINK(1)", postingUrl: 'https://jobs.example.com/1?a="b"' })]));
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    const styles = strFromU8(files["xl/styles.xml"]);
    expect(styles).toContain('<color rgb="FFFFFFFF"/>');
    expect(styles).toContain('<fgColor rgb="FF1F3A5F"/>');
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Company</t></is></c>');
    expect(sheet).toContain('<c r="D2" t="str" s="3"><f>HYPERLINK(&quot;https://jobs.example.com/1?a=&quot;&quot;b&quot;&quot;&quot;,&quot;Click here&quot;)</f>');
    expect(sheet).toContain('<c r="B2" t="inlineStr" s="2"><is><t xml:space="preserve">=HYPERLINK(1)</t></is></c>');
  });

  it("is just the header row while there's nothing to list", () => {
    expect(sheetTable([]).map((cells) => cells.map((cell) => cell.text))).toEqual([HEADER]);
  });
});
