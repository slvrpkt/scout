"use client";

import { Dialog } from "radix-ui";
import { useState, useSyncExternalStore } from "react";

import { buttonClassName } from "@/components/ui/button";

const LATER_KEY = "google-expired-later";
const never = () => () => {};

function saidLater(): boolean {
  try {
    return sessionStorage.getItem(LATER_KEY) === "1";
  } catch {
    return false;
  }
}

/** Asks to renew Google's access once it's stopped working; "Later" holds until the browser tab closes. */
export function GoogleExpiredDialog({ email }: { email: string }) {
  const later = useSyncExternalStore(never, saidLater, () => true);
  const [closed, setClosed] = useState(false);
  const close = () => {
    try {
      sessionStorage.setItem(LATER_KEY, "1");
    } catch {
      // Without storage it simply asks again on the next page.
    }
    setClosed(true);
  };
  return (
    <Dialog.Root open={!later && !closed} onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-dialog border border-line-popover bg-card p-6 shadow-menu">
          <Dialog.Title className="font-serif text-[22px] leading-tight">Renew your Google access</Dialog.Title>
          <Dialog.Description className="text-sm text-muted">
            Google has stopped accepting Scout&apos;s access to {email}. Until you renew it, Scout can&apos;t send email, check your inbox, read your calendar or save to Drive. It takes one click and a Google sign-in.
          </Dialog.Description>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className={buttonClassName("secondary", "md")}>
              Later
            </button>
            <a href="/api/google/connect" className={buttonClassName("primary", "md", "hover:text-on-primary")}>
              Renew Google access
            </a>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
