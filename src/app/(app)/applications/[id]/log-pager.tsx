import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";

import { buttonClassName } from "@/components/ui/button";
import type { LogNeighbours } from "@/lib/applications-data";

/** Previous and Next through the Job application log, in its order as last left, with where this one is. */
export function LogPager({ neighbours: { previous, next, position, total } }: { neighbours: LogNeighbours }) {
  const step = (id: string | null, label: string, icon: ReactNode, after = false) =>
    id ? (
      <Link href={`/applications/${id}`} className={buttonClassName("secondary", "sm")}>
        {!after && icon}
        {label}
        {after && icon}
      </Link>
    ) : (
      <span aria-disabled="true" className={buttonClassName("secondary", "sm", "pointer-events-none opacity-50")}>
        {!after && icon}
        {label}
        {after && icon}
      </span>
    );
  return (
    <nav aria-label="Applications in the log" className="flex items-center gap-2">
      {step(previous, "Previous", <ChevronLeft size={14} aria-hidden="true" />)}
      <span className="text-meta text-muted tabular-nums">
        {position} of {total}
      </span>
      {step(next, "Next", <ChevronRight size={14} aria-hidden="true" />, true)}
    </nav>
  );
}
