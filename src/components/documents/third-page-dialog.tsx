"use client";

import { Dialog } from "radix-ui";

import { Button } from "@/components/ui/button";

/**
 * "A third page?", asked before the base resume's two-page fit shortens the
 * 3 most recent jobs. Two pages is the preference; a third is used only with
 * leave. Closing it without an answer downloads nothing.
 */
export function ThirdPageDialog({ open, onAnswer }: { open: boolean; onAnswer: (allow: boolean | null) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onAnswer(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-dialog border border-line-popover bg-card p-6 shadow-menu">
          <Dialog.Title className="font-serif text-[22px] leading-tight">Use a third page?</Dialog.Title>
          <Dialog.Description className="text-sm text-muted">
            Your older jobs are already as short as they go. Fitting two pages now would mean shortening your 3 most recent jobs. May your resume use
            up to three pages instead, keeping them in full? Either way, anything shortened is rewritten in fewer words, keeping the facts.
          </Dialog.Description>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => onAnswer(false)}>
              Keep it to two pages
            </Button>
            <Button onClick={() => onAnswer(true)}>Allow up to three pages</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
