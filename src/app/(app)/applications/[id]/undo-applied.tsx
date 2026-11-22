"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { toastResult } from "@/components/toast";
import { undoStatus } from "@/lib/status-actions";

/**
 * Undo beside "Marked as applied on…", after its toast has gone: puts the
 * application back as it was before (the status, the applied date, and the
 * copies saved as sent), while that's still its latest change.
 */
export function UndoApplied({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button title="Undo marking this as applied"
      type="button"
      aria-disabled={pending || undefined}
      onClick={() =>
        !pending &&
        startTransition(async () => {
          if (toastResult(await undoStatus({ eventId })).ok) router.refresh();
        })
      }
      className="text-meta font-medium text-success underline underline-offset-2 hover:text-ink aria-disabled:opacity-60"
    >
      Undo
    </button>
  );
}
