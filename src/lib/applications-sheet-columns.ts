import type { ApplicationRow } from "@/lib/applications-data";
import { NOTE_KINDS } from "@/lib/activity";
import { statusLabel } from "@/lib/applications-list";
import { EMPLOYER_LABELS } from "@/lib/employer-type";

// The Job application log's Google Sheet, as CSV (applications-sheet.ts).

/** A file's cell: its link in Google Drive, once the Drive backup has saved it. */
const inDrive = (link: string | null) => link ?? "Not in Drive yet";

/**
 * The table's columns (applications/table.tsx), in its order: Company, Role
 * with its link and labels (manual, employer, posted, apply by), Salary, Location,
 * Things To Note, Applied Using, Status, Match, Applied, Resume & Cover Letter and
 * Job Description (links to the files in Google Drive), Activity (the latest
 * event) and Updated. A column added to the table is added here too; a test
 * keeps the two in step.
 */
export const SHEET_COLUMNS: { label: string; value: (row: ApplicationRow) => string }[] = [
  { label: "Company", value: (row) => row.company },
  { label: "Role", value: (row) => row.role },
  { label: "Salary", value: (row) => row.salary || "Not listed" },
  { label: "Posting Link", value: (row) => row.postingUrl },
  { label: "Source", value: (row) => (row.manual ? "Manual" : "Agentic") },
  { label: "Employer", value: (row) => (row.employer.type ? EMPLOYER_LABELS[row.employer.type] : "") },
  { label: "Posted", value: (row) => row.posted ?? `Created ${row.created}` },
  { label: "Apply By", value: (row) => row.deadline ?? "" },
  { label: "Location", value: (row) => row.location || "Not given" },
  { label: "Things To Note", value: (row) => row.thingsToNote },
  { label: "Applied Using", value: (row) => row.appliedVia.value ?? "" },
  { label: "Status", value: (row) => statusLabel(row.status) + (row.archived ? " (Archived)" : "") },
  { label: "Match", value: (row) => (row.match ? `${row.match.hit}/${row.match.total}` : "Not matched") },
  { label: "Applied", value: (row) => row.sent ?? "Not applied" },
  { label: "Resume & Cover Letter", value: (row) => inDrive(row.driveLinks.documents) },
  { label: "Job Description", value: (row) => inDrive(row.driveLinks.posting) },
  { label: "Activity", value: (row) => (row.latestEvent ? `${NOTE_KINDS[row.latestEvent.kind]}: ${row.latestEvent.body}` : "") },
  { label: "Updated", value: (row) => row.updated },
];

/** A CSV cell: quoted when it holds a comma, quote or line break, and never read as a formula. */
function cell(text: string): string {
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The sheet as CSV: the header row, then a row per application. With none, just the header. */
export function sheetCsv(rows: readonly ApplicationRow[]): string {
  return [SHEET_COLUMNS.map((column) => column.label), ...rows.map((row) => SHEET_COLUMNS.map((column) => column.value(row)))]
    .map((line) => line.map(cell).join(","))
    .join("\r\n");
}

