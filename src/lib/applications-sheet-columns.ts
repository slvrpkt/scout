import { strToU8, zipSync } from "fflate";

import type { ApplicationRow } from "@/lib/applications-data";
import { NOTE_KINDS } from "@/lib/activity";
import { statusLabel } from "@/lib/applications-list";
import { EMPLOYER_LABELS } from "@/lib/employer-type";

// The Job application log's Google Sheet (applications-sheet.ts), built as an
// Excel file, which Google Drive turns into a Sheet keeping its look: the
// header row bold, white on blue, and frozen; links as a short "Click here";
// every other column wrapped, so it reads without opening the cells.

/** A cell: its text and, for a link, where it goes. */
export type SheetCell = { text: string; link?: string };

/** Where a remote job is: "Remote", with a real place after it when there is one ("Anywhere" isn't). */
export function sheetLocation(row: Pick<ApplicationRow, "location" | "mode">): string {
  const place = row.location.trim();
  if (!/remote/i.test(row.mode)) return place || "Not given";
  const vague = !place || /^(anywhere|remote|worldwide|global|any ?where in the world)$/i.test(place);
  return vague ? "Remote" : /remote/i.test(place) ? place : `Remote · ${place}`;
}

/** A link cell: "Click here", or what to say without one. */
const linkTo = (url: string | null, missing: string): SheetCell => (url && /^https?:\/\//i.test(url) ? { text: "Click here", link: url } : { text: missing });

/**
 * The table's columns (applications/table.tsx), in its order, but for Match:
 * Company, Role with its link and labels (manual, employer, posted, apply by),
 * Salary, Location, Things To Note, Applied Using, Status, Applied, Resume &
 * Cover Letter and Job Description (links to the files in Google Drive),
 * Activity (the latest event) and Updated. A column added to the table is
 * added here too; a test keeps the two in step. `width` is in characters.
 */
export const SHEET_COLUMNS: { label: string; width: number; value: (row: ApplicationRow) => SheetCell }[] = [
  { label: "Company", width: 22, value: (row) => ({ text: row.company }) },
  { label: "Role", width: 30, value: (row) => ({ text: row.role }) },
  { label: "Salary", width: 18, value: (row) => ({ text: row.salary || "Not listed" }) },
  { label: "Posting Link", width: 12, value: (row) => linkTo(row.postingUrl, "") },
  { label: "Source", width: 10, value: (row) => ({ text: row.manual ? "Manual" : "Agentic" }) },
  { label: "Employer", width: 12, value: (row) => ({ text: row.employer.type ? EMPLOYER_LABELS[row.employer.type] : "" }) },
  { label: "Posted", width: 14, value: (row) => ({ text: row.posted ?? `Created ${row.created}` }) },
  { label: "Apply By", width: 12, value: (row) => ({ text: row.deadline ?? "" }) },
  { label: "Location", width: 18, value: (row) => ({ text: sheetLocation(row) }) },
  { label: "Things To Note", width: 34, value: (row) => ({ text: row.thingsToNote }) },
  { label: "Applied Using", width: 16, value: (row) => ({ text: row.appliedVia.value ?? "" }) },
  { label: "Status", width: 14, value: (row) => ({ text: statusLabel(row.status) + (row.archived ? " (Archived)" : "") }) },
  { label: "Applied", width: 14, value: (row) => ({ text: row.sent ?? "Not applied" }) },
  { label: "Resume & Cover Letter", width: 14, value: (row) => linkTo(row.driveLinks.documents, "Not in Drive yet") },
  { label: "Job Description", width: 14, value: (row) => linkTo(row.driveLinks.posting, "Not in Drive yet") },
  { label: "Activity", width: 40, value: (row) => ({ text: row.latestEvent ? `${NOTE_KINDS[row.latestEvent.kind]}: ${row.latestEvent.body}` : "" }) },
  { label: "Updated", width: 14, value: (row) => ({ text: row.updated }) },
];

/** The sheet's cells: the header row, then a row per application. */
export function sheetTable(rows: readonly ApplicationRow[]): SheetCell[][] {
  return [SHEET_COLUMNS.map((column) => ({ text: column.label })), ...rows.map((row) => SHEET_COLUMNS.map((column) => column.value(row)))];
}

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** "A", "B", … "AA": a column's letters. */
const columnName = (index: number): string => (index < 26 ? "" : columnName(Math.floor(index / 26) - 1)) + String.fromCharCode(65 + (index % 26));

// Styles: 0 plain, 1 the header (bold white on blue, wrapped), 2 wrapped text, 3 a link (blue, underlined, not wrapped).
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><u/><sz val="10"/><color rgb="FF1155CC"/><name val="Arial"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F3A5F"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(table: SheetCell[][]): string {
  const rows = table.map((cells, rowIndex) => {
    const r = rowIndex + 1;
    const body = cells
      .map((cell, columnIndex) => {
        const ref = `${columnName(columnIndex)}${r}`;
        if (rowIndex === 0) return `<c r="${ref}" t="inlineStr" s="1"><is><t xml:space="preserve">${xml(cell.text)}</t></is></c>`;
        if (cell.link) {
          // A formula Google Sheets keeps: the link shows as its short text.
          const formula = `HYPERLINK("${cell.link.replace(/"/g, '""')}","${cell.text.replace(/"/g, '""')}")`;
          return `<c r="${ref}" t="str" s="3"><f>${xml(formula)}</f><v>${xml(cell.text)}</v></c>`;
        }
        return `<c r="${ref}" t="inlineStr" s="2"><is><t xml:space="preserve">${xml(cell.text)}</t></is></c>`;
      })
      .join("");
    return `<row r="${r}"${rowIndex === 0 ? ' ht="22" customHeight="1"' : ""}>${body}</row>`;
  });
  const cols = SHEET_COLUMNS.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols>
<sheetData>${rows.join("")}</sheetData>
</worksheet>`;
}

/** The sheet as an Excel file, which Google Drive turns into a Sheet. With no applications, just the header row. */
export function sheetXlsx(rows: readonly ApplicationRow[]): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Job application log" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(STYLES),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml(sheetTable(rows))),
  });
}
