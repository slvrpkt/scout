"use client";

import { useRef, useState, type SyntheticEvent } from "react";

import { archiveApplication, DeleteApplicationDialog } from "@/components/application-lifecycle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/toast";
import { StatusDot } from "@/components/ui/status-dot";
import { EmployerType, type ApplicationStatus } from "@/generated/prisma/enums";
import type { ApplicationRow } from "@/lib/applications-data";
import { EMPLOYER_LABELS } from "@/lib/employer-type";
import { STATUSES } from "@/lib/status";

import { setEmployerType } from "./actions";
import { AddEventDialog } from "./add-event-dialog";

/**
 * The "⋯" menu on a card or a table row: "Move to…" any status, the
 * keyboard and touch alternative to dragging (decided 28 September 2026),
 * then Add event (a call, an interview, a note), who the employer is
 * (Scout's guess until set), Archive and Delete (E9-5).
 */
export function RowMenu({ row, onMove }: { row: ApplicationRow; onMove: (to: ApplicationStatus) => void }) {
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const stop = (event: SyntheticEvent) => event.stopPropagation();
  return (
    // The menu and the dialog open in portals, but React still passes their
    // events up to the card and the row: pressing in them mustn't start a
    // drag, and clicking in them mustn't open the application.
    <div className="contents" onMouseDown={stop} onTouchStart={stop} onClick={stop}>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={trigger}
          aria-label={`Actions for ${[row.role, row.company].filter(Boolean).join(", ")}`}
          className="grid size-7 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink data-[state=open]:bg-hover data-[state=open]:text-ink"
        >
          <span aria-hidden="true" className="text-base leading-none">
            ⋯
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Move to</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={row.status} onValueChange={(value) => value !== row.status && onMove(value as ApplicationStatus)}>
            {STATUSES.map((status) => (
              <DropdownMenuRadioItem key={status.value} value={status.value}>
                <StatusDot status={status.value} />
                {status.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAdding(true)}>Add event…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Employer</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={row.employer.chosen ?? "AUTO"}
            onValueChange={(value) => void setEmployerType({ id: row.id, type: value === "AUTO" ? null : (value as EmployerType) }).then((result) => !result.ok && toast(result.error))}
          >
            <DropdownMenuRadioItem value="AUTO">Let Scout decide</DropdownMenuRadioItem>
            {Object.values(EmployerType).map((type) => (
              <DropdownMenuRadioItem key={type} value={type}>
                {EMPLOYER_LABELS[type]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void archiveApplication(row.id, !row.archived)}>
            {row.archived ? "Unarchive" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDeleting(true)} className="text-danger data-highlighted:text-error-strong">
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteApplicationDialog id={row.id} open={deleting} onOpenChange={setDeleting} returnFocusTo={trigger} />
      <AddEventDialog row={row} open={adding} onOpenChange={setAdding} returnFocusTo={trigger} />
    </div>
  );
}
