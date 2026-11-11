"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";

import { replacePosting } from "./actions";

/**
 * Replace the job description, at the bottom of the original posting: for a
 * job board that sent only the start. The full text is read again and
 * matched with your profile; the resume is rewritten only when you ask.
 */
export function ReplacePosting({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const save = () =>
    !pending &&
    text.trim() &&
    startTransition(async () => {
      if (toastResult(await replacePosting({ id, text })).ok) {
        setOpen(false);
        setText("");
        router.refresh();
      }
    });
  if (!open) {
    return (
      <div>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Replace the job description
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`replace-${id}`} className="text-sm font-medium text-ink">
        Paste the full job description
      </label>
      <textarea
        id={`replace-${id}`}
        rows={10}
        maxLength={100_000}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Copy it from the company's job page and paste it here."
        className="w-full rounded-control border border-line-input bg-input px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-primary focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" aria-disabled={pending || !text.trim() || undefined} onClick={save}>
          {pending ? "Reading it, about half a minute…" : "Use this description"}
        </Button>
        <Button variant="secondary" size="sm" aria-disabled={pending || undefined} onClick={() => !pending && setOpen(false)}>
          Cancel
        </Button>
        <span className="text-xs text-muted">The match and ATS score follow it. Your resume is rewritten only when you ask.</span>
      </div>
    </div>
  );
}
