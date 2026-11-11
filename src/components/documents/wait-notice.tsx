"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/** How long the notice stays before it closes by itself. */
export const WAIT_NOTICE_SECONDS = 5;

/**
 * A notice at the top center of the screen while a file takes a while to
 * make, so a slow download doesn't look stuck. It closes by itself after a
 * few seconds, counted down on its OK button, or when OK is clicked.
 */
export function WaitNotice({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  const [left, setLeft] = useState(WAIT_NOTICE_SECONDS);
  useEffect(() => {
    if (left <= 0) {
      onClose();
      return;
    }
    const timer = setTimeout(() => setLeft((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [left, onClose]);
  return (
    <div
      role="status"
      className="fixed top-6 left-1/2 z-50 flex w-[min(520px,calc(100vw-32px))] -translate-x-1/2 items-start gap-4 rounded-card border border-line bg-card px-5 py-4 text-sm text-ink shadow-lg"
    >
      <p className="flex-1 leading-relaxed">{message}</p>
      <Button size="sm" onClick={onClose}>
        OK ({left})
      </Button>
    </div>
  );
}
