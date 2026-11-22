"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Conversation, formatWhen, KIND_LABELS } from "@/components/email/conversation";
import { PageHeader } from "@/components/page-header";
import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { checkInbox, dismissEmail, linkEmail, markEmailImportant, markEmailRead } from "@/lib/google/actions";
import type { EmailView, Inbox } from "@/lib/google/inbox-data";
import { cn } from "@/lib/cn";

/** The inbox's filters, by what you've marked and what the mail needs. */
type Filter = "all" | "unread" | "important" | "answer" | "look";
const FILTERS: { value: Filter; label: string; keep: (email: EmailView) => boolean }[] = [
  { value: "all", label: "All", keep: () => true },
  { value: "unread", label: "Unread", keep: (email) => email.unread },
  { value: "important", label: "Important", keep: (email) => email.important },
  { value: "answer", label: "Needs an answer", keep: (email) => Boolean(email.application) && !email.handled },
  { value: "look", label: "Needs a look", keep: (email) => !email.application },
];

/** The mail around one message: its application's whole conversation, or its own thread when it isn't linked; oldest first. */
export const conversationOf = (email: EmailView, conversations: readonly EmailView[]) =>
  conversations.filter((other) => (email.application ? other.application?.id === email.application.id : other.threadId === email.threadId));

/** Whether a message matches what was typed in the search box: sender, subject, company, role, summary or text. */
const matches = (email: EmailView, query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = [email.fromName, email.fromAddress, email.subject, email.summary, email.body, email.application?.company, email.application?.role].join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
};

/**
 * The inbox (E15-3), laid out like a mail program: the messages on the left,
 * newest first, and the one picked on the right with its whole conversation
 * and the answer to it. Opening a message marks it read; it can be marked
 * unread again, and important (★), and the list filtered by either, or
 * searched.
 */
export function InboxScreen({
  inbox,
  connected,
  configured,
  lastSync,
  problem,
  aiReady,
  timeZone,
  applications,
}: {
  inbox: Inbox;
  /** Reading replies is on and allowed. */
  connected: boolean;
  /** The server has a Google client. */
  configured: boolean;
  lastSync: Date | null;
  problem: string | null;
  aiReady: boolean;
  timeZone?: string;
  /** For linking a mail by hand. */
  applications: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [checking, startChecking] = useTransition();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Marks shown at once, ahead of the server's answer.
  const [marks, setMarks] = useState<Record<string, { unread?: boolean; important?: boolean }>>({});

  const messages = useMemo(() => inbox.messages.map((email) => ({ ...email, ...marks[email.id] })), [inbox.messages, marks]);
  const counts = Object.fromEntries(FILTERS.map(({ value, keep }) => [value, messages.filter(keep).length])) as Record<Filter, number>;
  const keep = FILTERS.find((entry) => entry.value === filter)!.keep;
  const shown = messages.filter((email) => keep(email) && matches(email, query));
  const selected = messages.find((email) => email.id === selectedId) ?? null;

  const check = () =>
    startChecking(async () => {
      toastResult(await checkInbox({}));
      router.refresh();
    });

  const setRead = (email: EmailView, read: boolean) => {
    setMarks((current) => ({ ...current, [email.id]: { ...current[email.id], unread: !read } }));
    void markEmailRead({ emailId: email.id, read }).then((result) => {
      if (!toastResult(result).ok) setMarks((current) => ({ ...current, [email.id]: { ...current[email.id], unread: read } }));
      else router.refresh();
    });
  };
  const setImportant = (email: EmailView, important: boolean) => {
    setMarks((current) => ({ ...current, [email.id]: { ...current[email.id], important } }));
    void markEmailImportant({ emailId: email.id, important }).then((result) => {
      if (!toastResult(result).ok) setMarks((current) => ({ ...current, [email.id]: { ...current[email.id], important: !important } }));
    });
  };
  const open = (email: EmailView) => {
    setSelectedId(email.id);
    if (email.unread) setRead(email, true);
  };

  return (
    <>
      <PageHeader
        title="Inbox"
        description={
          connected
            ? "Employers' replies from your Gmail, linked to their applications. Pick one to read it, see the whole conversation and answer it."
            : "Connect Gmail in Settings → Google, and employers' replies show up here, linked to their applications."
        }
        actions={
          connected ? (
            <>
              <span className={problem ? "text-meta text-error" : "text-meta text-muted"}>
                {problem ?? (lastSync ? `Checked ${formatWhen(lastSync, timeZone)}` : "Not checked yet")}
              </span>
              <Button title="Check Gmail for new messages now" variant="secondary" onClick={check} disabled={checking}>
                {checking ? "Checking…" : "Check now"}
              </Button>
            </>
          ) : (
            <Link title="Connect Gmail, to see employers' emails here" href="/settings?section=google" className={buttonClassName("primary", "md", "hover:text-on-primary")}>
              {configured ? "Connect Gmail" : "Set up Google"}
            </Link>
          )
        }
      />
      <div className="flex flex-col gap-4 px-10 pb-[72px]">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            aria-label="Search the inbox"
            placeholder="Search sender, subject, company or anything in the email"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-[220px] flex-[0_1_420px] rounded-control border border-line-input bg-input px-3 py-2.5 text-sm placeholder:text-muted focus-visible:border-primary focus-visible:outline-offset-0"
          />
          <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
            {FILTERS.map(({ value, label }) => (
              <button title="Show only these emails"
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  "flex items-baseline gap-1.5 rounded-control border px-3 py-2 text-control",
                  filter === value ? "border-primary bg-selected font-medium text-primary-text" : "border-line-field bg-card hover:border-line-strong hover:bg-hover",
                )}
              >
                {label}
                <span className="text-meta text-muted tabular-nums">{counts[value]}</span>
              </button>
            ))}
          </div>
        </div>

        {messages.length === 0 ? (
          <p className="rounded-panel border border-line-card bg-card px-7 py-6 text-sm text-muted">
            {connected ? "Nothing yet. Replies to your applications will show up here." : "Nothing here yet."}
          </p>
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
            <ul aria-label="Messages" className="flex flex-col overflow-hidden rounded-panel border border-line-card bg-card lg:max-h-[calc(100vh-240px)] lg:overflow-y-auto">
              {shown.length === 0 && <li className="px-4 py-5 text-sm text-muted">{query ? "No messages match your search." : "No messages here."}</li>}
              {shown.map((email) => (
                <li key={email.id} className="border-b border-line last:border-b-0">
                  <button title="Read this email"
                    type="button"
                    aria-pressed={selected?.id === email.id}
                    onClick={() => open(email)}
                    className={cn("flex w-full items-start gap-2.5 px-4 py-3 text-left hover:bg-hover", selected?.id === email.id && "bg-selected")}
                  >
                    <span aria-hidden="true" className={cn("mt-1.5 size-2 flex-none rounded-full", email.unread ? "bg-primary" : "bg-transparent")} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn("truncate text-field", email.unread ? "font-semibold text-ink" : "text-ink")}>{email.fromName || email.fromAddress}</span>
                        <span className="flex-none text-meta text-muted">{formatWhen(email.sentAt, timeZone)}</span>
                      </span>
                      <span className={cn("truncate text-meta", email.unread ? "font-medium text-ink" : "text-muted")}>
                        {email.application ? [email.application.company, email.application.role].filter(Boolean).join(", ") : "Not linked to an application"}
                      </span>
                      <span className="line-clamp-2 text-meta text-muted">{email.summary || email.subject || email.body.slice(0, 140)}</span>
                      <span className="flex items-center gap-2 text-meta">
                        {email.kind && <span className="text-muted">{KIND_LABELS[email.kind]}</span>}
                        {email.application && !email.handled && <span className="font-medium text-warning">Needs an answer</span>}
                        {email.important && <span aria-label="Important" className="text-warning">★</span>}
                        {email.unread && <span className="sr-only">Unread</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {selected ? (
              <section aria-label="Message" key={selected.id} className="flex min-w-0 flex-col gap-4 rounded-panel border border-line-card bg-card px-6 py-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <h2 className="text-[17px] leading-snug font-medium text-pretty">{selected.subject || "(No subject)"}</h2>
                    <p className="text-meta text-muted">
                      {selected.fromName ? `${selected.fromName} <${selected.fromAddress}>` : selected.fromAddress} · {formatWhen(selected.sentAt, timeZone)}
                    </p>
                    {selected.application && (
                      <p className="flex items-center gap-2 text-meta">
                        <StatusDot status={selected.application.status} />
                        <Link title="Open the application this email is about" href={`/applications/${selected.application.id}?tab=conversation`} className="text-ink underline underline-offset-2">
                          {[selected.application.company, selected.application.role].filter(Boolean).join(", ")}
                        </Link>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button title="Mark this email as read or unread" size="sm" variant="secondary" onClick={() => setRead(selected, selected.unread)}>
                      {selected.unread ? "Mark as read" : "Mark as unread"}
                    </Button>
                    <Button title="Mark or unmark this email as important" size="sm" variant="secondary" aria-pressed={selected.important} onClick={() => setImportant(selected, !selected.important)}>
                      {selected.important ? "★ Important" : "☆ Mark important"}
                    </Button>
                  </div>
                </div>
                {selected.application ? (
                  <Conversation emails={conversationOf(selected, inbox.conversations)} aiReady={aiReady} timeZone={timeZone} />
                ) : (
                  <Unlinked email={selected} applications={applications} />
                )}
              </section>
            ) : (
              <p className="hidden rounded-panel border border-dashed border-line-card px-6 py-10 text-center text-sm text-muted lg:block">Pick a message to read it here.</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** Mail that isn't linked: its text, then pick its application or hide it. */
function Unlinked({ email, applications }: { email: EmailView; applications: { id: string; label: string }[] }) {
  const router = useRouter();
  const [choice, setChoice] = useState("");
  const [pending, startTransition] = useTransition();
  const run = (work: () => Promise<{ ok: boolean }>) =>
    startTransition(async () => {
      if ((await work()).ok) router.refresh();
    });
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm whitespace-pre-wrap text-ink">{email.body || "(No text)"}</p>
      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <p className="text-meta text-muted">I couldn&apos;t tell which application this is about. Link it to answer it here.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Link to application"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            className="h-[30px] max-w-[320px] min-w-0 flex-1 cursor-pointer rounded-control border border-line-input bg-input px-2 text-control"
          >
            <option value="">Choose application…</option>
            {applications.map((application) => (
              <option key={application.id} value={application.id}>
                {application.label}
              </option>
            ))}
          </select>
          <Button title="Link this email to the application you chose" size="sm" variant="secondary" disabled={!choice || pending} onClick={() => run(async () => toastResult(await linkEmail({ emailId: email.id, applicationId: choice })))}>
            Link
          </Button>
          <Button title="This email isn't about a job: hide it from the inbox" size="sm" variant="text" className="ml-auto" disabled={pending} onClick={() => run(async () => toastResult(await dismissEmail({ emailId: email.id })))}>
            Not job-related
          </Button>
        </div>
      </div>
    </div>
  );
}
