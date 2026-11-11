"use client";

import { useRewriting } from "./rewriting";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";

import { rewriteFromProfile } from "./actions";

/** A draft written before the profile last changed: rewritten only when asked, as it may have your edits. */
export function OutdatedNotice({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useRewriting(pending);
  const rewrite = () =>
    !pending &&
    startTransition(async () => {
      if (toastResult(await rewriteFromProfile({ id })).ok) router.refresh();
    });
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-warning-surface px-4 py-2.5 text-meta text-warning">
      <span>Your profile has changed since this custom tailored resume was written. If you plan to apply, rewrite it first.</span>
      <Button size="sm" aria-disabled={pending || undefined} onClick={rewrite}>
        {pending ? "Rewriting…" : "Rewrite"}
      </Button>
    </div>
  );
}
