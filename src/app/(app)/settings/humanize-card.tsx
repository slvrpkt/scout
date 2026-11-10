"use client";

import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Card } from "@/components/ui/card";
import { Toggle } from "@/components/ui/toggle";

import { updateSettings } from "./actions";

/**
 * "Humanize writing", under the AI provider and its key: resumes, cover
 * letters, emails and replies are written without the usual signs of AI
 * text. Only the wording changes; the facts stay as the profile has them.
 */
export function HumanizeCard({ initial }: { initial: boolean }) {
  const track = useTrackSave();
  const [on, setOn] = useState(initial);
  const change = async (next: boolean) => {
    setOn(next);
    if (!toastResult(await track(updateSettings({ humanize: next }))).ok) setOn(!next);
  };
  return (
    <Card padding="none" className="flex flex-col px-7 pt-1.5 pb-4">
      <Toggle
        className="py-4"
        label="Humanize writing"
        description="Write resumes, cover letters, emails and replies without the usual signs of AI text: stock words, staged contrasts, filler and chat leftovers. Only the wording changes, never the facts. Adds a little to each request."
        checked={on}
        onCheckedChange={(next) => void change(next)}
      />
      <p className="text-meta text-muted">
        Based on the{" "}
        <a href="https://github.com/blader/humanizer" target="_blank" rel="noopener noreferrer" className="text-muted underline underline-offset-2 hover:text-ink">
          humanizer skill
        </a>{" "}
        by Siqi Chen (MIT), which draws on Wikipedia&apos;s &ldquo;Signs of AI writing&rdquo;.
      </p>
    </Card>
  );
}
