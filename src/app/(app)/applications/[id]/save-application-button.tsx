"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { SaveForLaterButton } from "@/components/save-for-later-button";
import { toastResult } from "@/components/toast";

import { saveApplicationForLater } from "./actions";

/** Save for later in the application's header: the same as on the job's card. */
export function SaveApplicationButton({ id, saved }: { id: string; saved: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Shown at once; put back if the save doesn't go through.
  const [shown, setShown] = useState(saved);
  const toggle = () =>
    startTransition(async () => {
      const next = !shown;
      setShown(next);
      if (toastResult(await saveApplicationForLater({ id, saved: next })).ok) router.refresh();
      else setShown(!next);
    });
  return <SaveForLaterButton saved={shown} busy={pending} onToggle={toggle} />;
}
