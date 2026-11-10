"use client";

import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Card } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";

import { updateSettings } from "./actions";

/** "ATS optimization", under Humanize writing: an ATS grade on each tailored resume, with what to fix and Rewrite to Reach A. */
export function AtsCard({ initial }: { initial: boolean }) {
  const track = useTrackSave();
  const [on, setOn] = useState(initial);
  const change = async (next: boolean) => {
    setOn(next);
    if (!toastResult(await track(updateSettings({ atsOptimize: next }))).ok) setOn(!next);
  };
  return (
    <Card padding="none" className="flex flex-col px-7 pt-1.5 pb-4">
      <Toggle
        className="py-4"
        label="ATS optimization"
        description="Grade each tailored resume on its format and how well it matches the job, and rewrite every new draft for what it misses, up to 3 times, until it reaches an A. It runs in the background after a draft is made."
        checked={on}
        onCheckedChange={(next) => void change(next)}
      />
      <p className="text-meta text-muted">
        Format checks based on{" "}
        <a href="https://github.com/career-ops-hq/career-ops" target="_blank" rel="noopener noreferrer" className="text-muted underline underline-offset-2">
          career-ops
        </a>{" "}
        (MIT). The grade is Scout&apos;s own measure, not a score from any ATS.
      </p>
    </Card>
  );
}
