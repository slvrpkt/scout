"use client";

import Link from "next/link";
import { Dialog } from "radix-ui";
import { useState, useSyncExternalStore } from "react";

import { buttonClassName } from "@/components/ui/button";

const SEEN_KEY = "cost-limit-seen";
const never = () => () => {};

function seen(): string {
  try {
    return sessionStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Says a cost limit has been passed; shown again this session only if the message changes. */
export function CostLimitDialog({ messages }: { messages: string[] }) {
  const text = messages.join(" ");
  const already = useSyncExternalStore(never, seen, () => text);
  const [closed, setClosed] = useState(false);
  const close = () => {
    try {
      sessionStorage.setItem(SEEN_KEY, text);
    } catch {
      // Without storage it simply says so again on the next page.
    }
    setClosed(true);
  };
  return (
    <Dialog.Root open={already !== text && !closed} onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-dialog border border-line-popover bg-card p-6 shadow-menu">
          <Dialog.Title className="font-serif text-[22px] leading-tight">Cost limit reached</Dialog.Title>
          <Dialog.Description asChild>
            <div className="flex flex-col gap-2 text-sm text-muted">
              {messages.map((message) => (
                <p key={message}>{message}</p>
              ))}
              <p>Everything else keeps working. It carries on when the period ends, or as soon as you raise the limit.</p>
            </div>
          </Dialog.Description>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className={buttonClassName("secondary", "md")}>
              Close
            </button>
            <Link href="/settings?section=costs" onClick={close} className={buttonClassName("primary", "md", "hover:text-on-primary")}>
              See costs
            </Link>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
