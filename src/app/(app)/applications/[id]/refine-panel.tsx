"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import type { Tab } from "./tabs";

/** A message in the panel. */
export type ChatEntry = {
  id: string;
  role: "USER" | "AI";
  text: string;
  /** The unit a message was about ("About: Summary"). */
  targetUnit: string | null;
  /** The opening "Here's what I tailored" message (E7-6), whose last paragraph is a footnote. */
  opening: boolean;
  /** A reply that changed units, which can be undone (E8-6). */
  canUndo: boolean;
  undone: boolean;
};

/** The unit the next message is about, picked with "Ask AI". */
export type ChatTarget = { label: string; name: string };

const SUBTITLES: Record<Tab, string> = {
  resume: "Ask for changes to your tailored resume. I'll only use what's in your profile.",
  letter: "Ask for changes to your cover letter. I'll only use what's in your profile.",
  email: "Ask for changes to your email. I'll only use what's in your profile.",
  conversation: "Answers to employers are drafted right in the conversation.",
  posting: "Switch to the resume, cover letter or email to make changes.",
  activity: "Switch to the resume, cover letter or email to make changes.",
  notes: "Switch to the resume, cover letter or email to make changes.",
};

/** The changes on the list, as one request: a single one as it is, several numbered. */
export function batchRequest(changes: readonly string[]): string {
  if (changes.length === 1) return changes[0];
  return ["Please make all of these changes:", ...changes.map((change, index) => `${index + 1}. ${change}`)].join("\n");
}

/**
 * "Refine with AI" (APP-7): the conversation about this application's
 * documents, with suggestions and a box to ask for a change. Changes are
 * gathered first: Enter (or a suggestion) adds one to the list, and Apply
 * sends them all as one request, which costs about the same as one change.
 * It sticks to the side of the documents, and moves below them on narrow
 * windows.
 */
export function RefinePanel({
  tab,
  messages,
  thinking,
  suggestions,
  target,
  onClearTarget,
  onSend,
  aiReady,
  focusRequest,
  children,
}: {
  tab: Tab;
  messages: ChatEntry[];
  /** A reply is on its way. */
  thinking: boolean;
  suggestions: string[];
  target: ChatTarget | null;
  onClearTarget: () => void;
  /** Resolves to whether the message was sent; the box keeps it otherwise. */
  onSend: (text: string) => Promise<boolean>;
  aiReady: boolean;
  /** Goes up when the box should take focus, e.g. after "Ask AI". */
  focusRequest: number;
  /** Under each message, by id: e.g. its Undo link (E8-6). */
  children?: (message: ChatEntry) => ReactNode;
}) {
  const [draft, setDraft] = useState("");
  // The changes gathered so far, for this tab only.
  const [list, setList] = useState<{ tab: Tab; changes: string[] }>({ tab, changes: [] });
  const changes = list.tab === tab ? list.changes : [];
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusRequest > 0) input.current?.focus();
  }, [focusRequest]);

  /** Adds a change to the list; nothing is sent yet. */
  const add = (text: string) => {
    const change = text.trim();
    if (!change) return;
    setList({ tab, changes: changes.includes(change) ? changes : [...changes, change] });
    setDraft("");
  };
  const remove = (change: string) => setList({ tab, changes: changes.filter((entry) => entry !== change) });
  // What Apply sends: the list, and what's still in the box.
  const toApply = [...changes, ...(draft.trim() && !changes.includes(draft.trim()) ? [draft.trim()] : [])];
  const apply = async () => {
    if (toApply.length === 0 || thinking) return;
    const before = { draft, changes };
    setDraft("");
    setList({ tab, changes: [] });
    if (!(await onSend(batchRequest(toApply)))) {
      setDraft(before.draft);
      setList({ tab, changes: before.changes });
    }
  };

  return (
    <aside
      aria-labelledby="refine-heading"
      className="flex-[1_0_380px] border-t border-line bg-paper @min-[780px]:border-t-0 @min-[780px]:border-l"
    >
      <div className="flex h-[min(100dvh,680px)] flex-col @min-[780px]:h-full">
        <div className="flex flex-col gap-1 px-6 pt-[26px] pb-3.5">
          <h2 id="refine-heading" className="text-[15px] font-medium">
            Refine with AI
          </h2>
          <p className="text-meta leading-[1.45] text-muted">{SUBTITLES[tab]}</p>
          {(tab === "resume" || tab === "letter" || tab === "email") && (
            <p className="mt-1 rounded-control bg-surface px-2.5 py-1.5 text-meta leading-[1.45] text-muted">
              <b className="text-ink">Only this application changes.</b> Edits here stay with this {tab === "resume" ? "resume" : tab === "letter" ? "cover letter" : "email"} and never go back to your
              Profile. For a lasting change, one every future resume uses,{" "}
              <Link href="/profile" className="font-medium text-ink underline underline-offset-2">
                edit your Profile
              </Link>
              .
            </p>
          )}
        </div>

        {/* column-reverse keeps the newest message in view. Focusable, so it scrolls from the keyboard too (E11-3). */}
        <div role="log" aria-label="Conversation" tabIndex={0} className="flex min-h-0 flex-1 flex-col-reverse overflow-auto px-6">
          <div className="flex flex-col gap-3.5 pt-1.5 pb-4">
            {messages.map((message) => (
              <div key={message.id} className={cn("flex flex-col gap-[5px]", message.role === "USER" ? "items-end" : "items-start")}>
                <Bubble message={message} />
                {children?.(message)}
              </div>
            ))}
            {thinking && <p className="pl-1 text-meta text-muted">Thinking…</p>}
          </div>
        </div>

        <div className="flex flex-col gap-2.5 border-t border-line px-6 pt-3.5 pb-6">
          {!aiReady && tab !== "posting" && (
            <p className="text-meta text-muted">
              Refining needs an AI provider.{" "}
              <Link href="/settings?section=ai" className="font-medium text-ink underline underline-offset-2">
                Choose one in Settings
              </Link>
            </p>
          )}
          {aiReady && suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  aria-disabled={thinking || changes.includes(suggestion) || undefined}
                  onClick={() => !changes.includes(suggestion) && add(suggestion)}
                  className="rounded-full border border-line-field bg-card px-[11px] py-1.5 text-label hover:border-line-strong aria-disabled:cursor-not-allowed aria-disabled:text-muted"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          {/* The changes gathered so far: Apply sends them together. */}
          {changes.length > 0 && (
            <section aria-label="Changes to make" className="flex flex-col gap-1.5 rounded-card border border-line bg-card px-3 py-2.5">
              <p className="text-label font-medium text-ink">Changes to make ({changes.length})</p>
              <ol className="flex flex-col gap-1">
                {changes.map((change, index) => (
                  <li key={change} className="flex items-start gap-2 text-sm">
                    <span className="flex-none text-muted tabular-nums">{index + 1}.</span>
                    <span className="flex-1">{change}</span>
                    <button type="button" aria-label={`Remove “${change}”`} onClick={() => remove(change)} className="flex-none rounded-full px-1 leading-none text-muted hover:text-ink">
                      ×
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <div className="flex flex-col gap-2 rounded-card border border-line-input bg-input px-3 py-2.5 focus-within:border-primary">
            {target && (
              <div className="flex">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-track py-1 pr-1.5 pl-2.5 text-label">
                  About: {target.label}
                  <button
                    type="button"
                    aria-label={`Stop asking about the ${target.name}`}
                    onClick={onClearTarget}
                    className="rounded-full px-1 text-[13px] leading-none text-muted hover:text-ink"
                  >
                    ×
                  </button>
                </span>
              </div>
            )}
            <textarea
              ref={input}
              aria-label="Ask for a change"
              rows={4}
              value={draft}
              placeholder={
                target
                  ? `What should change in the ${target.name}?\nPress Enter to add it, then Apply changes.`
                  : "Type a change and press Enter to add it, e.g. “sound more confident”.\nAdd all your changes first, then press Apply changes."
              }
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter starts a new line; not while an input method is composing.
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  add(draft);
                }
              }}
              className="w-full resize-none bg-transparent text-sm leading-normal text-ink outline-none placeholder:text-muted"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Shift+Enter for a new line</span>
              <span className="flex gap-2">
                <Button size="sm" className="px-3.5 py-[7px]" aria-disabled={thinking || toApply.length === 0 || undefined} onClick={() => void apply()}>
                  {toApply.length > 1 ? `Apply ${toApply.length} changes` : "Apply changes"}
                </Button>
              </span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** One message: the user's in a dark bubble on the right, the AI's in a card on the left. */
function Bubble({ message }: { message: ChatEntry }) {
  if (message.role === "USER") {
    return (
      <div className="max-w-[92%] rounded-card border border-primary bg-primary px-3.5 py-[11px] text-[13.5px] leading-[1.55] text-pretty whitespace-pre-wrap text-on-primary">
        {message.targetUnit && <p className="mb-1 text-xs opacity-70">About: {message.targetUnit}</p>}
        {message.text}
      </div>
    );
  }
  const blocks = messageBlocks(message.text);
  const foot = message.opening && blocks.length > 1 && blocks.at(-1)?.kind === "text" ? blocks.pop() : null;
  return (
    <div className="flex max-w-[92%] flex-col gap-2 rounded-card border border-line-card bg-card px-3.5 py-[11px] text-[13.5px] leading-[1.55] text-pretty">
      {blocks.map((block, index) =>
        block.kind === "list" ? (
          <ul key={index} className="flex list-disc flex-col gap-1 pl-[1.1em]">
            {block.lines.map((line, item) => (
              <li key={item}>{line}</li>
            ))}
          </ul>
        ) : (
          <p key={index} className="whitespace-pre-wrap">
            {block.text}
          </p>
        ),
      )}
      {foot?.kind === "text" && <p className="mt-0.5 text-label text-muted">{foot.text}</p>}
    </div>
  );
}

type Block = { kind: "text"; text: string } | { kind: "list"; lines: string[] };

/** A message's paragraphs; one whose lines all start with "- " is a list. */
export function messageBlocks(text: string): Block[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph): Block => {
      const lines = paragraph.split("\n");
      return lines.every((line) => line.startsWith("- "))
        ? { kind: "list", lines: lines.map((line) => line.slice(2).trim()) }
        : { kind: "text", text: paragraph };
    });
}
