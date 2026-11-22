import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkInbox, dismissEmail, linkEmail, markEmailImportant, markEmailRead } from "@/lib/google/actions";
import type { EmailView } from "@/lib/google/inbox-data";

import { InboxScreen } from "./inbox-screen";

vi.mock("@/lib/google/actions", () => ({
  checkInbox: vi.fn(async () => ({ ok: true, data: null })),
  dismissEmail: vi.fn(async () => ({ ok: true, data: null })),
  linkEmail: vi.fn(async () => ({ ok: true, data: null })),
  markEmailRead: vi.fn(async () => ({ ok: true, data: null })),
  markEmailImportant: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/inbox" }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));
// The conversation and its answer have their own tests.
vi.mock("@/components/email/conversation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/email/conversation")>()),
  Conversation: ({ emails }: { emails: EmailView[] }) => <div data-testid="conversation">{emails.map((email) => email.body).join(" | ")}</div>,
}));

const email = (extra: Partial<EmailView>): EmailView => ({
  id: "e1",
  threadId: "t1",
  direction: "INCOMING",
  fromName: "Anna Keller",
  fromAddress: "anna@northwind.example",
  subject: "Re: Application",
  body: "Could we talk?",
  sentAt: new Date("2026-10-17T13:02:00Z"),
  kind: "INTERVIEW",
  summary: "Invites you to a call.",
  questions: [],
  suggestedStatus: null,
  confirmedAt: null,
  replyDraft: "",
  replyDraftDoc: null,
  replyGaps: [],
  handled: false,
  read: true,
  unread: true,
  important: false,
  application: { id: "nw", company: "Northwind", role: "Designer", status: "SENT" },
  ...extra,
});

const waiting = email({});
const unlinked = email({ id: "e2", threadId: "t2", fromName: "Acme Talent", subject: "A role for you", body: "We have a role.", application: null, kind: null });
const update = email({ id: "e3", kind: "REJECTION", handled: true, unread: false, important: true, summary: "Won't go ahead.", body: "Sorry." });
const sent = email({ id: "o1", direction: "OUTGOING", fromName: "Me", body: "My application.", unread: false });
const inbox = { messages: [waiting, unlinked, update], conversations: [sent, waiting, update, unlinked] };

const props = { inbox, connected: true, configured: true, lastSync: null, problem: null, aiReady: true, applications: [{ id: "lg", label: "Ledgerly, Designer" }] };
const list = () => screen.getByRole("list", { name: "Messages" });
const items = () => within(list()).getAllByRole("button").map((item) => item.textContent);

beforeEach(() => vi.clearAllMocks());

describe("the inbox (E15-3)", () => {
  it("lists every message with counts per filter, and filters by what you've marked", async () => {
    const user = userEvent.setup();
    render(<InboxScreen {...props} />);
    expect(items()).toHaveLength(3);
    expect(screen.getByRole("button", { name: /^Unread\s*2$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Important\s*1$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Needs an answer\s*1$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Needs a look\s*1$/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Important\s*1$/ }));
    expect(items()).toEqual([expect.stringContaining("Won't go ahead.")]);
    await user.click(screen.getByRole("button", { name: /^Unread\s*2$/ }));
    expect(items()).toHaveLength(2);
  });

  it("searches sender, subject, company and text", async () => {
    const user = userEvent.setup();
    render(<InboxScreen {...props} />);
    await user.type(screen.getByRole("searchbox", { name: "Search the inbox" }), "acme role");
    expect(items()).toEqual([expect.stringContaining("Acme Talent")]);
    await user.clear(screen.getByRole("searchbox", { name: "Search the inbox" }));
    await user.type(screen.getByRole("searchbox", { name: "Search the inbox" }), "nothing like this");
    expect(within(list()).getByText("No messages match your search.")).toBeInTheDocument();
  });

  it("opens a message beside the list with its whole conversation, marking it read", async () => {
    const user = userEvent.setup();
    render(<InboxScreen {...props} />);
    await user.click(within(list()).getByRole("button", { name: /Anna Keller.*Invites you to a call/ }));
    const message = screen.getByRole("region", { name: "Message" });
    expect(within(message).getByRole("heading", { name: "Re: Application" })).toBeInTheDocument();
    expect(within(message).getByTestId("conversation")).toHaveTextContent("My application. | Could we talk? | Sorry.");
    expect(markEmailRead).toHaveBeenCalledWith({ emailId: "e1", read: true });
    expect(screen.getByRole("button", { name: /^Unread\s*1$/ })).toBeInTheDocument();
    await user.click(within(message).getByRole("button", { name: "Mark as unread" }));
    expect(markEmailRead).toHaveBeenLastCalledWith({ emailId: "e1", read: false });
    await user.click(within(message).getByRole("button", { name: "☆ Mark important" }));
    expect(markEmailImportant).toHaveBeenCalledWith({ emailId: "e1", important: true });
    expect(screen.getByRole("button", { name: /^Important\s*2$/ })).toBeInTheDocument();
  });

  it("shows mail that isn't linked with a way to link it or hide it", async () => {
    const user = userEvent.setup();
    render(<InboxScreen {...props} />);
    await user.click(within(list()).getByRole("button", { name: /Acme Talent/ }));
    const message = screen.getByRole("region", { name: "Message" });
    expect(message).toHaveTextContent("We have a role.");
    await user.selectOptions(within(message).getByRole("combobox", { name: "Link to application" }), "lg");
    await user.click(within(message).getByRole("button", { name: "Link" }));
    expect(linkEmail).toHaveBeenCalledWith({ emailId: "e2", applicationId: "lg" });
    await user.click(within(message).getByRole("button", { name: "Not job-related" }));
    expect(dismissEmail).toHaveBeenCalledWith({ emailId: "e2" });
  });

  it("checks the inbox now, or offers to connect Gmail", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<InboxScreen {...props} />);
    await user.click(screen.getByRole("button", { name: "Check now" }));
    expect(checkInbox).toHaveBeenCalled();
    unmount();
    render(<InboxScreen {...props} connected={false} inbox={{ messages: [], conversations: [] }} />);
    expect(screen.getByRole("link", { name: "Connect Gmail" })).toHaveAttribute("href", "/settings?section=google");
  });
});
