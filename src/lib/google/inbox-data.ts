import "server-only";

import { answerDocSchema, type AnswerNode } from "@/lib/rich-answer";
import type { ApplicationStatus, EmailDirection, ReplyKind } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

import { questionsSchema } from "./sync";

// What the inbox and an application's Conversation tab show (E15-3).

export type EmailView = {
  id: string;
  threadId: string;
  direction: EmailDirection;
  fromName: string;
  fromAddress: string;
  /** Where an answer goes, when it isn't the sender. */
  replyTo?: string;
  subject: string;
  body: string;
  sentAt: Date;
  kind: ReplyKind | null;
  summary: string;
  questions: string[];
  suggestedStatus: ApplicationStatus | null;
  confirmedAt: Date | null;
  replyDraft: string;
  /** The drafted answer with its formatting, as the editor keeps it; null for plain text. */
  replyDraftDoc: AnswerNode | null;
  replyGaps: string[];
  handled: boolean;
  /** Read by the AI (classified), not by you: see `unread`. */
  read: boolean;
  /** Incoming mail you haven't opened, or marked unread. */
  unread: boolean;
  /** Marked important (★). */
  important: boolean;
  application: { id: string; company: string; role: string; status: ApplicationStatus } | null;
};

const SELECT = {
  id: true,
  threadId: true,
  direction: true,
  fromName: true,
  fromAddress: true,
  replyTo: true,
  subject: true,
  body: true,
  sentAt: true,
  kind: true,
  summary: true,
  questions: true,
  suggestedStatus: true,
  confirmedAt: true,
  replyDraft: true,
  replyDraftDoc: true,
  replyGaps: true,
  handledAt: true,
  classifiedWith: true,
  readAt: true,
  important: true,
  application: { select: { id: true, company: true, role: true, title: true, status: true } },
} as const;

type Row = Awaited<ReturnType<typeof prisma.emailMessage.findFirstOrThrow<{ select: typeof SELECT }>>>;

const list = (value: unknown) => {
  const parsed = questionsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
};

function view({ handledAt, classifiedWith, readAt, application, questions, replyGaps, replyDraftDoc, ...row }: Row): EmailView {
  const doc = answerDocSchema.safeParse(replyDraftDoc);
  return {
    ...row,
    replyDraftDoc: doc.success ? doc.data : null,
    questions: list(questions),
    replyGaps: list(replyGaps),
    handled: handledAt !== null,
    read: classifiedWith !== null,
    unread: row.direction === "INCOMING" && readAt === null,
    application: application
      ? { id: application.id, company: application.company, role: application.role || application.title, status: application.status }
      : null,
  };
}

/** An application's mail, oldest first. */
export async function loadConversation(applicationId: string): Promise<EmailView[]> {
  const rows = await prisma.emailMessage.findMany({ where: { applicationId, dismissedAt: null }, orderBy: { sentAt: "asc" }, select: SELECT });
  return rows.map(view);
}

/** How many messages the inbox lists, newest first. */
const INBOX_LIMIT = 500;

export type Inbox = {
  /** Every incoming message, newest first: the inbox's list. */
  messages: EmailView[];
  /** Every message in and out, oldest first, for the conversation beside the one picked. */
  conversations: EmailView[];
};

export async function loadInbox(): Promise<Inbox> {
  const messages = await prisma.emailMessage.findMany({ where: { direction: "INCOMING", dismissedAt: null }, orderBy: { sentAt: "desc" }, take: INBOX_LIMIT, select: SELECT });
  const applicationIds = [...new Set(messages.flatMap((message) => (message.application ? [message.application.id] : [])))];
  const threadIds = [...new Set(messages.map((message) => message.threadId))];
  const conversations = await prisma.emailMessage.findMany({
    where: { dismissedAt: null, OR: [{ applicationId: { in: applicationIds } }, { threadId: { in: threadIds } }] },
    orderBy: { sentAt: "asc" },
    select: SELECT,
  });
  return { messages: messages.map(view), conversations: conversations.map(view) };
}

/** How many messages you haven't opened: the sidebar's count. */
export async function inboxCount(): Promise<number> {
  return prisma.emailMessage.count({ where: { direction: "INCOMING", dismissedAt: null, readAt: null } });
}

/** Per application: replies waiting for an answer, for the dashboard. */
export async function waitingByApplication(): Promise<Map<string, { count: number; summary: string }>> {
  const rows = await prisma.emailMessage.findMany({
    where: { direction: "INCOMING", applicationId: { not: null }, handledAt: null, dismissedAt: null },
    orderBy: { sentAt: "desc" },
    select: { applicationId: true, summary: true, fromName: true },
  });
  const map = new Map<string, { count: number; summary: string }>();
  for (const row of rows) {
    const entry = map.get(row.applicationId!);
    if (entry) entry.count++;
    else map.set(row.applicationId!, { count: 1, summary: row.summary || `${row.fromName || "They"} wrote back.` });
  }
  return map;
}
