"use client";

import { useState, useTransition } from "react";

import { toastResult } from "@/components/toast";
import type { ApplicationRow } from "@/lib/applications-data";
import { APPLIED_VIA_OPTIONS } from "@/lib/applied-via";
import { cn } from "@/lib/cn";

import { setAppliedVia } from "./actions";

/** The menu's first entry: Scout's guess, or the way back to it from a choice. */
const GUESS = "";

/**
 * Applied Using: where the application went in. Scout's guess shows in
 * muted italics until the user picks one; "Use Scout's guess" goes back.
 */
export function AppliedViaSelect({ row }: { row: Pick<ApplicationRow, "id" | "role" | "company" | "appliedVia"> }) {
  const [shown, setShown] = useState(row.appliedVia);
  const [syncedWith, setSyncedWith] = useState(row.appliedVia);
  const [, startTransition] = useTransition();
  if (syncedWith !== row.appliedVia) {
    setSyncedWith(row.appliedVia);
    setShown(row.appliedVia);
  }
  const pick = (value: string) => {
    const previous = shown;
    setShown(value === GUESS ? { value: null, auto: true } : { value, auto: false });
    startTransition(async () => {
      const result = await setAppliedVia({ id: row.id, via: value === GUESS ? null : (value as (typeof APPLIED_VIA_OPTIONS)[number]) });
      if (!toastResult(result).ok) setShown(previous);
    });
  };
  const first = shown.auto ? (shown.value ?? "Not known") : "Use Scout's guess";
  return (
    <select
      aria-label={`Applied using, for ${[row.role, row.company].filter(Boolean).join(" at ")}`}
      title={shown.auto ? (shown.value ? `Scout's guess: ${shown.value}. Pick one to change it.` : "Pick where you applied") : undefined}
      value={shown.auto ? GUESS : (shown.value ?? GUESS)}
      onChange={(event) => pick(event.target.value)}
      className={cn(
        "-ml-1.5 w-full min-w-0 cursor-pointer appearance-none rounded-[6px] border border-transparent bg-transparent py-1 pr-2 pl-1.5 text-sm hover:border-line-field focus-visible:border-primary",
        shown.auto ? "text-muted italic" : "text-ink",
      )}
    >
      <option value={GUESS}>{first}</option>
      {APPLIED_VIA_OPTIONS.filter((option) => !(shown.auto && option === shown.value)).map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
