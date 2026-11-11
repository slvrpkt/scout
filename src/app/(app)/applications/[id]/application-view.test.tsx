import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import { copyText } from "@/lib/copy-text";
import { demoLetterUnits, demoProfile, demoResumeUnits } from "@/lib/demo-profile";
import { BUILT_IN_THEMES } from "@/lib/themes";

import { retry } from "@/lib/jobs/actions";
import type { JobView } from "@/lib/jobs/runner";

import {
  addMatchSkill,
  addNote,
  deleteNote,
  leaveOutUnit,
  listVersions,
  loadVersion,
  putBackTrimmed,
  recordSend,
  restoreNote,
  restoreUnit,
  restoreVersion,
  saveUnit,
  sendMessage,
  setApplicationTheme,
  setFollowThemeLayout,
  startRegenerating,
  startWritingEmail,
  undoEmailRewrite,
  undoMessage,
  updateNote,
} from "./actions";
import { ApplicationView, type ApplicationViewProps } from "./application-view";

vi.mock("./actions", () => ({
  setApplicationTheme: vi.fn(async () => ({ ok: true, data: null })),
  setFollowThemeLayout: vi.fn(async () => ({ ok: true, data: null })),
  saveUnit: vi.fn(async ({ text }: { text: string }) => ({ ok: true, data: { text } })),
  startRegenerating: vi.fn(async () => ({ ok: true, data: "job-1" })),
  restoreUnit: vi.fn(async () => ({ ok: true, data: null })),
  sendMessage: vi.fn(async () => ({ ok: true, data: { jobId: "reply-1" } })),
  undoMessage: vi.fn(async () => ({ ok: true, data: { edited: [{ document: "RESUME", unitId: "summary" }] } })),
  addMatchSkill: vi.fn(async () => ({ ok: true, data: { name: "Kubernetes" } })),
  addNote: vi.fn(async () => ({ ok: true, data: null })),
  updateNote: vi.fn(async () => ({ ok: true, data: null })),
  deleteNote: vi.fn(async () => ({
    ok: true,
    data: { body: "Called John.", kind: "CALL", at: "2026-10-03T13:00:00.000Z", createdAt: "2026-10-03T13:00:00.000Z", updatedAt: "2026-10-03T13:00:00.000Z" },
  })),
  recordSend: vi.fn(async () => ({ ok: true, data: { copies: 2 } })),
  restoreNote: vi.fn(async () => ({ ok: true, data: null })),
  putBackTrimmed: vi.fn(async () => ({ ok: true, data: null })),
  leaveOutUnit: vi.fn(async () => ({ ok: true, data: { index: 2 } })),
  listVersions: vi.fn(async () => ({ ok: true, data: [] })),
  loadVersion: vi.fn(),
  restoreVersion: vi.fn(async () => ({ ok: true, data: null, toast: "Restored the resume as it was then." })),
  startWritingEmail: vi.fn(async () => ({ ok: true, data: "email-1" })),
  undoEmailRewrite: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("@/lib/copy-text", () => ({ copyText: vi.fn(async () => true) }));
vi.mock("@/lib/jobs/actions", () => ({ retry: vi.fn(async () => ({ ok: true, data: null })) }));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => null }));
// Jobs report whatever the test says, as the real hook would.
const jobs = vi.hoisted(() => ({ listeners: new Map<string, (job: unknown) => void>(), revisions: new Map<string, number>() }));
vi.mock("@/hooks/use-job", async () => {
  const { useEffect } = await import("react");
  return {
    useJob: (id: string | null, revision: number, onChange?: (job: unknown) => void) => {
      useEffect(() => {
        if (!id) return;
        jobs.listeners.set(id, (job) => onChange?.(job));
        jobs.revisions.set(id, revision);
        return () => void jobs.listeners.delete(id);
      });
      return null;
    },
  };
});

function report(job: Partial<JobView>) {
  const view = { id: "job-1", type: "regenerate-unit", status: "RUNNING", step: null, error: null, result: null, ...job };
  act(() => jobs.listeners.get(view.id)?.(view));
}
vi.mock("@/components/change-status", () => ({ changeStatus: vi.fn() }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const theme = (id: string) => BUILT_IN_THEMES.find((entry) => entry.id === id)!;

const props: ApplicationViewProps = {
  application: {
    id: "app-1",
    title: "Senior Product Designer · Ledgerly",
    company: "Ledgerly",
    location: "Amsterdam",
    status: "DRAFT",
    tone: "WARM",
    language: "English",
    followThemeLayout: false,
    archived: false,
    nextInterviewAt: null,
  },
  posting: { text: "Ledgerly is hiring.\n\n  - Figma", url: "", pasted: "27 Sep" },
  match: null,
  requirements: [],
  facts: [{ id: "f1", text: "I know their product as a customer." }],
  drive: null,
  activity: [{ kind: "created", id: "created", date: "27 Sep", at: "2026-09-27T10:00:00.000Z" }],
  meta: ["Amsterdam"],
  resume: { units: demoResumeUnits(), theme: theme("editorial") },
  letter: { units: demoLetterUnits(), theme: theme("editorial") },
  themes: [...BUILT_IN_THEMES, { ...theme("modern"), id: "mine", name: "Mine", builtIn: false }],
  baseThemeId: "modern",
  email: null,
  writingEmail: null,
  attachments: { resume: "Jane Doe – Ledgerly – Resume.pdf", letter: "Jane Doe – Ledgerly – Cover letter.pdf" },
  profile: demoProfile(),
  paper: "A4",
  dateFormat: "DAY_MONTH_YEAR",
  includeReferences: false,
  letterDate: new Date(Date.UTC(2026, 8, 28)),
  score: { hit: 5, total: 7 },
  initialTab: "resume",
  aiReady: true,
  rewriting: [],
  messages: [],
  refining: null,
  suggestions: { resume: ["Make the summary shorter"], letter: ["Make it more formal"], email: ["Shorter, under 100 words"] },
};

beforeEach(() => {
  window.history.replaceState(null, "", "/applications/app-1");
  vi.mocked(setFollowThemeLayout).mockClear();
  vi.mocked(setApplicationTheme).mockClear();
  vi.mocked(saveUnit).mockClear();
  vi.mocked(startRegenerating).mockClear();
  vi.mocked(restoreUnit).mockClear();
  vi.mocked(sendMessage).mockClear();
  vi.mocked(undoMessage).mockClear();
  vi.mocked(startWritingEmail).mockClear();
  vi.mocked(undoEmailRewrite).mockClear();
  vi.mocked(toast).mockClear();
  router.refresh.mockClear();
  router.push.mockClear();
});

const summary = demoResumeUnits()[0];

describe("the document tabs (E8-2)", () => {
  it("has Resume, Cover letter, Email and the posting with its match", () => {
    render(<ApplicationView {...props} />);
    const tabs = within(screen.getByRole("tablist", { name: "Application" })).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Custom tailored resume", "Custom tailored cover letter", "Email", "Job posting · 5/7 match", "Activity", "Events / Notes"]);
    expect(screen.getByRole("tab", { name: "Custom tailored resume" })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the tab in the URL", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.click(screen.getByRole("tab", { name: "Custom tailored cover letter" }));
    expect(window.location.search).toBe("?tab=letter");
    await user.click(screen.getByRole("tab", { name: "Custom tailored resume" }));
    expect(window.location.search).toBe("");
  });

  it("opens on the tab from the URL", () => {
    render(<ApplicationView {...props} initialTab="posting" />);
    expect(screen.getByRole("tab", { name: /Job posting/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/Ledgerly is hiring\./)).toHaveTextContent("Ledgerly is hiring. - Figma");
    // What the AI should know for this job, one free-text box beside the posting (APP-15).
    const facts = screen.getByRole("region", { name: "What the AI Should Know For This Job" });
    expect(within(facts).getByRole("textbox")).toHaveValue("I know their product as a customer.");
    expect(within(facts).getByRole("link", { name: "Facts about me" })).toHaveAttribute("href", "/profile?section=facts");
  });

  it("shows the tailored resume in its theme, in a single column by default", () => {
    render(<ApplicationView {...props} />);
    expect(screen.getByText(/^Custom tailored resume ·/)).toHaveTextContent("Custom tailored resume · Editorial theme");
    const resume = screen.getByRole("article", { name: "Resume" });
    expect(resume.querySelector('[data-unit="summary"]')).toHaveTextContent(demoResumeUnits()[0].text);
    // Editorial is a single-column theme: nothing to switch.
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("lets a sidebar theme use its own layout, saved on the application", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} resume={{ units: demoResumeUnits(), theme: theme("modern") }} />);
    const resume = screen.getByRole("article", { name: "Resume" });
    expect(within(resume).queryByText("Contact")).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Sidebar layout" }));
    expect(setFollowThemeLayout).toHaveBeenCalledWith({ id: "app-1", follow: true });
  });

  it("changes the resume's and cover letter's theme together from the Theme menu (#226)", async () => {
    const user = userEvent.setup();
    let answer: (result: { ok: true; data: null }) => void = () => {};
    vi.mocked(setApplicationTheme).mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    render(<ApplicationView {...props} />);
    expect(screen.queryByRole("switch", { name: "Sidebar layout" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Editorial theme" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitemradio", { name: "Editorial" })).toHaveAttribute("aria-checked", "true");
    expect(within(menu).getByRole("menuitemradio", { name: "Modern base theme" })).toBeInTheDocument();
    expect(within(menu).getAllByRole("menuitemradio").map((item) => item.textContent).slice(-2)).toEqual(["Atlas", "Mine"]);
    expect(within(menu).getByRole("separator")).toBeInTheDocument();

    // Shown in the new theme while it's saved: Modern has a sidebar, so its layout switch appears.
    await user.click(within(menu).getByRole("menuitemradio", { name: "Modern base theme" }));
    expect(setApplicationTheme).toHaveBeenCalledWith({ id: "app-1", themeId: "modern" });
    expect(screen.getByRole("button", { name: "Modern theme" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Sidebar layout" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Custom tailored cover letter" }));
    expect(screen.getByRole("button", { name: "Modern theme" })).toBeInTheDocument();
    await act(async () => answer({ ok: true, data: null }));
  });

  it("doesn't save the theme the documents already have", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} initialTab="letter" />);
    await user.click(screen.getByRole("button", { name: "Editorial theme" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Editorial" }));
    expect(setApplicationTheme).not.toHaveBeenCalled();
  });

  it("follows the theme's layout when the application says so", () => {
    render(
      <ApplicationView
        {...props}
        application={{ ...props.application, followThemeLayout: true }}
        resume={{ units: demoResumeUnits(), theme: theme("modern") }}
      />,
    );
    expect(screen.getByRole("switch", { name: "Sidebar layout" })).toHaveAttribute("aria-checked", "true");
    expect(within(screen.getByRole("article", { name: "Resume" })).getByText("Contact")).toBeInTheDocument();
  });

  it("lays out the cover letter with its word count", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.click(screen.getByRole("tab", { name: "Custom tailored cover letter" }));
    const letter = screen.getByRole("article", { name: "Cover letter" });
    expect(within(letter).getByText("28 September 2026")).toBeInTheDocument();
    expect(within(letter).getByText("Ledgerly · Hiring team")).toBeInTheDocument();
    expect(within(letter).getByText("Dear Ledgerly team,")).toBeInTheDocument();
    expect(screen.getByText(/^Custom tailored cover letter · about \d+0 words$/)).toBeInTheDocument();
  });

  it("says so when a document is missing", () => {
    render(<ApplicationView {...props} resume={null} score={null} />);
    expect(screen.getByText("This application has no tailored resume.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Job posting" })).toBeInTheDocument();
  });
});

describe("editing a unit (E8-3)", () => {
  it("gives every unit a focusable frame with its toolbar", () => {
    render(<ApplicationView {...props} />);
    expect(screen.getByText("Hover a section to edit or regenerate it")).toBeInTheDocument();
    const frame = screen.getByRole("group", { name: "Summary" });
    expect(frame).toHaveAttribute("tabindex", "0");
    expect(frame).toHaveAttribute("data-unit", "summary");
    expect(within(frame).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    // Printed parts that aren't units, like the header, have none.
    // Every unit prints, the Skills section included.
    expect(screen.getAllByRole("group")).toHaveLength(demoResumeUnits().length);
  });

  it("leaves a part of the resume out, with Undo on the toast (#217)", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    const frame = screen.getByRole("group", { name: "Summary" });
    expect(within(frame).getAllByRole("button").map((button) => button.textContent)).toEqual(["Edit", "Regenerate", "Ask AI", "Leave out"]);
    await user.click(within(frame).getByRole("button", { name: "Leave out" }));
    expect(leaveOutUnit).toHaveBeenCalledWith({ id: "app-1", unitId: "summary" });
    expect(toast).toHaveBeenLastCalledWith("Left out: Summary.", { action: expect.objectContaining({ label: "Undo" }) });
    await act(async () => vi.mocked(toast).mock.lastCall?.[1]?.action?.onClick());
    expect(putBackTrimmed).toHaveBeenCalledWith({ id: "app-1", index: 2 });
    expect(toast).toHaveBeenLastCalledWith("Put back.");
  });

  it("keeps a publication as written: Edit and Leave out, no Regenerate or Ask AI (#218)", () => {
    render(<ApplicationView {...props} />);
    const publication = screen.getByRole("group", { name: /^Publication “Doe, J\./ });
    expect(within(publication).getAllByRole("button").map((button) => button.textContent)).toEqual(["Edit", "Leave out"]);
    expect(within(publication).getByText("Doe, J.").tagName).toBe("STRONG");
  });

  it("leaves nothing out of the cover letter", () => {
    render(<ApplicationView {...props} initialTab="letter" />);
    expect(screen.queryByRole("button", { name: "Leave out" })).not.toBeInTheDocument();
  });

  it("swaps in a text box and saves what was written", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ApplicationView {...props} />);
    const frame = screen.getByRole("group", { name: "Summary" });
    await user.click(within(frame).getByRole("button", { name: "Edit" }));

    const box = screen.getByRole("textbox", { name: "Edit Summary" });
    expect(box).toHaveFocus();
    expect(box).toHaveValue(summary.text);
    await user.clear(box);
    await user.type(box, "Calm tools for complex work.");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(saveUnit).toHaveBeenCalledWith({
      id: "app-1",
      document: "RESUME",
      unitId: "summary",
      text: "Calm tools for complex work.",
      expected: summary.text,
    });
    expect(screen.queryByRole("textbox", { name: /^Edit / })).not.toBeInTheDocument();
    // The action refreshes the page with the saved text.
    const units = demoResumeUnits().map((unit) => (unit.id === "summary" ? { ...unit, text: "Calm tools for complex work." } : unit));
    rerender(<ApplicationView {...props} resume={{ units, theme: theme("editorial") }} />);
    expect(screen.getByRole("group", { name: "Summary" })).toHaveTextContent("Calm tools for complex work.");
  });

  it("keeps a role's title line while its bullets are edited", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    const role = screen.getByRole("group", { name: "Studio Brik role" });
    await user.click(within(role).getByRole("button", { name: "Edit" }));
    expect(role).toHaveTextContent(/^UX Designer, Studio Brik/);
    expect(within(role).getByRole("textbox")).toHaveAccessibleDescription("One bullet per line");
  });

  it("cancels with Escape and keeps the text", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.click(within(screen.getByRole("group", { name: "Summary" })).getByRole("button", { name: "Edit" }));
    await user.type(screen.getByRole("textbox", { name: "Edit Summary" }), " More.");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Summary" })).toHaveTextContent(summary.text);
    expect(saveUnit).not.toHaveBeenCalled();
  });

  it("keeps the editor open with the text when saving fails", async () => {
    const user = userEvent.setup();
    vi.mocked(saveUnit).mockResolvedValueOnce({ ok: false, error: "This part changed while you were editing it." });
    render(<ApplicationView {...props} />);
    await user.click(within(screen.getByRole("group", { name: "Summary" })).getByRole("button", { name: "Edit" }));
    await user.type(screen.getByRole("textbox", { name: "Edit Summary" }), " More.");
    await user.keyboard("{Control>}{Enter}{/Control}");

    // The save runs in a transition: wait for it to come back.
    await waitFor(() => expect(toast).toHaveBeenCalledWith("This part changed while you were editing it."));
    expect(screen.getByRole("textbox", { name: "Edit Summary" })).toHaveValue(`${summary.text} More.`);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
  });

  it("glows for a moment after a save", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<ApplicationView {...props} />);
      const frame = screen.getByRole("group", { name: "Summary" });
      await user.click(within(frame).getByRole("button", { name: "Edit" }));
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(frame.className).toMatch(/flash/);
      act(() => vi.advanceTimersByTime(1700));
      expect(frame.className).not.toMatch(/flash/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks details the fact guard couldn't back", async () => {
    const user = userEvent.setup();
    const units = demoResumeUnits().map((unit) => (unit.id === "summary" ? { ...unit, unverified: ["40%", "2019"] } : unit));
    render(<ApplicationView {...props} resume={{ units, theme: theme("editorial") }} />);
    const marker = screen.getByRole("button", { name: "Check this: “40%”, “2019”" });
    await user.click(marker);
    expect(screen.getByText(/I couldn't find “40%”, “2019” in your profile or the posting/)).toBeInTheDocument();
  });
});

describe("regenerating a unit (E8-4)", () => {
  const rewritten = { text: "A new summary.", unverified: undefined };
  const toastAction = () => vi.mocked(toast).mock.lastCall?.[1]?.action;

  it("dims the unit while it's rewritten and leaves the rest usable", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    const frame = screen.getByRole("group", { name: "Summary" });
    await user.click(within(frame).getByRole("button", { name: "Regenerate" }));

    expect(startRegenerating).toHaveBeenCalledWith({ id: "app-1", document: "RESUME", unitId: "summary" });
    expect(frame).toHaveAttribute("aria-busy", "true");
    expect(within(frame).getByText("Rewriting…")).toBeInTheDocument();
    expect(within(frame).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Languages" })).getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("shows the new text with Undo on the toast", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    const frame = screen.getByRole("group", { name: "Summary" });
    await user.click(within(frame).getByRole("button", { name: "Regenerate" }));
    report({ status: "DONE", result: { outcome: "rewritten", previous: summary, unit: { ...summary, ...rewritten } } });

    expect(frame).not.toHaveAttribute("aria-busy");
    expect(router.refresh).toHaveBeenCalled();
    expect(frame.className).toMatch(/flash/);
    expect(toast).toHaveBeenLastCalledWith("Rewrote the summary.", { action: expect.objectContaining({ label: "Undo" }) });

    await act(async () => toastAction()?.onClick());
    expect(restoreUnit).toHaveBeenCalledWith({
      id: "app-1",
      document: "RESUME",
      unitId: "summary",
      text: summary.text,
      unverified: undefined,
      expected: "A new summary.",
    });
    expect(toast).toHaveBeenLastCalledWith("Put the summary back.");
  });

  it("keeps an edit made meanwhile", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.click(within(screen.getByRole("group", { name: "Summary" })).getByRole("button", { name: "Regenerate" }));
    report({ status: "DONE", result: { outcome: "changed" } });
    expect(toast).toHaveBeenLastCalledWith("The summary changed while I was rewriting it, so I left your version.");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("restores the unit on failure and offers Retry", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    const frame = screen.getByRole("group", { name: "Summary" });
    await user.click(within(frame).getByRole("button", { name: "Regenerate" }));
    report({ status: "FAILED", error: "The AI server didn't answer in time." });

    expect(frame).not.toHaveAttribute("aria-busy");
    expect(frame).toHaveTextContent(summary.text);
    expect(toast).toHaveBeenLastCalledWith("The AI server didn't answer in time.", { action: expect.objectContaining({ label: "Retry" }) });

    await act(async () => toastAction()?.onClick());
    expect(retry).toHaveBeenCalledWith({ id: "job-1" });
    expect(frame).toHaveAttribute("aria-busy", "true");
    expect(jobs.revisions.get("job-1")).toBe(1);
  });

  it("picks up a rewrite that was running before a reload", () => {
    render(<ApplicationView {...props} rewriting={[{ jobId: "job-7", document: "COVER_LETTER", unitId: "paragraph:2" }]} initialTab="letter" />);
    expect(screen.getByText("Rewriting…").closest("[data-unit]")).toHaveAttribute("data-unit", "paragraph:2");
  });

  it("points to Settings without an AI provider", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} aiReady={false} />);
    await user.click(within(screen.getByRole("group", { name: "Summary" })).getByRole("button", { name: "Regenerate" }));
    expect(startRegenerating).not.toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith("That needs an AI provider. Choose one in Settings → AI provider.", {
      action: expect.objectContaining({ label: "Open Settings" }),
    });
    toastAction()?.onClick();
    expect(router.push).toHaveBeenCalledWith("/settings?section=ai");
  });
});

describe("the Refine with AI panel (E8-5)", () => {
  const opening = {
    id: "m1",
    role: "AI" as const,
    text: "Here's what I tailored for Ledgerly:\n\n- Rewrote your summary\n- Wrote a warm cover letter\n\nNothing invented: every line comes from your profile.",
    targetUnit: null,
    opening: true,
    canUndo: false,
    undone: false,
  };
  const panel = () => screen.getByRole("complementary", { name: "Refine with AI" });
  const input = () => screen.getByRole("textbox", { name: "Ask for a change" });
  /** Apply: sends the changes on the list. */
  const apply = (user: ReturnType<typeof userEvent.setup>) => user.click(within(panel()).getByRole("button", { name: /^Apply/ }));

  it("shows the conversation, with the opening list and its footnote", () => {
    render(
      <ApplicationView
        {...props}
        messages={[opening, { id: "m2", role: "USER", text: "Shorter please", targetUnit: "Summary", opening: false, canUndo: false, undone: false }]}
      />,
    );
    const log = within(panel()).getByRole("log", { name: "Conversation" });
    expect(within(log).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Rewrote your summary", "Wrote a warm cover letter"]);
    expect(within(log).getByText("Nothing invented: every line comes from your profile.")).toHaveClass("text-muted");
    expect(within(log).getByText("About: Summary")).toBeInTheDocument();
  });

  it("changes its subtitle and suggestions with the tab", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    expect(within(panel()).getByText(/^Ask for changes to your tailored resume/)).toBeInTheDocument();
    expect(within(panel()).getByRole("button", { name: "Make the summary shorter" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Custom tailored cover letter" }));
    expect(within(panel()).getByText(/^Ask for changes to your cover letter/)).toBeInTheDocument();
    expect(within(panel()).getByRole("button", { name: "Make it more formal" })).toBeInTheDocument();
    // The posting has the page to itself.
    await user.click(screen.getByRole("tab", { name: /Job posting/ }));
    expect(screen.queryByRole("complementary", { name: "Refine with AI" })).not.toBeInTheDocument();
  });

  it("says edits stay with this application, and points to the Profile for a lasting one", () => {
    render(<ApplicationView {...props} />);
    expect(within(panel()).getByText("Only this application changes.")).toBeInTheDocument();
    expect(within(panel()).getByRole("link", { name: "edit your Profile" })).toHaveAttribute("href", "/profile");
  });

  it("adds a suggestion to the list, and sends it with Apply, then thinks", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.click(screen.getByRole("button", { name: "Make the summary shorter" }));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(within(panel()).getByRole("region", { name: "Changes to make" })).toHaveTextContent("Make the summary shorter");
    await apply(user);
    expect(sendMessage).toHaveBeenCalledWith({ id: "app-1", text: "Make the summary shorter", viewing: "RESUME", target: null });
    expect(within(panel()).getByText("Thinking…")).toBeInTheDocument();
  });

  it("gathers changes with Enter, keeps new lines with Shift+Enter, and sends them all as one with Apply", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.type(input(), "Sound more{Shift>}{Enter}{/Shift}confident");
    expect(input()).toHaveValue("Sound more\nconfident");
    await user.keyboard("{Enter}");
    expect(sendMessage).not.toHaveBeenCalled();
    expect(input()).toHaveValue("");
    await user.type(input(), "Mention Linear{Enter}");
    await user.click(within(panel()).getByRole("button", { name: "Remove “Mention Linear”" }));
    await user.type(input(), "Shorter summary{Enter}");
    await user.click(within(panel()).getByRole("button", { name: "Apply 2 changes" }));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: "Please make all of these changes:\n1. Sound more\nconfident\n2. Shorter summary" }));
    expect(within(panel()).queryByRole("region", { name: "Changes to make" })).not.toBeInTheDocument();
  });

  it("asks about a unit picked with Ask AI", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.click(within(screen.getByRole("group", { name: "Summary" })).getByRole("button", { name: "Ask AI" }));
    expect(input()).toHaveFocus();
    expect(input()).toHaveAttribute("placeholder", expect.stringMatching(/^What should change in the summary\?/));
    expect(within(panel()).getByText("About: Summary")).toBeInTheDocument();

    await user.type(input(), "Mention payments{Enter}");
    await apply(user);
    expect(sendMessage).toHaveBeenCalledWith({
      id: "app-1",
      text: "Mention payments",
      viewing: "RESUME",
      target: { document: "RESUME", unitId: "summary" },
    });
    expect(within(panel()).queryByRole("button", { name: "Stop asking about the summary" })).not.toBeInTheDocument();
  });

  it("drops the picked unit with ×", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.click(within(screen.getByRole("group", { name: "Summary" })).getByRole("button", { name: "Ask AI" }));
    await user.click(screen.getByRole("button", { name: "Stop asking about the summary" }));
    expect(input()).toHaveAttribute("placeholder", expect.stringMatching(/^Type a change and press Enter to add it/));
  });

  it("shows the reply's edits, switching to the document they're on", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.type(input(), "Make the letter more formal{Enter}");
    await apply(user);
    report({ id: "reply-1", type: "refine", status: "DONE", result: { messageId: "m9", edited: [{ document: "COVER_LETTER", unitId: "paragraph:1" }] } });

    expect(router.refresh).toHaveBeenCalled();
    expect(within(panel()).queryByText("Thinking…")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Custom tailored cover letter" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("group", { name: demoLetterUnits()[0].label }).className).toMatch(/flash/);
  });

  it("keeps the message in the box when it can't be sent", async () => {
    const user = userEvent.setup();
    vi.mocked(sendMessage).mockResolvedValueOnce({ ok: false, error: "I'm still working on your last message." });
    render(<ApplicationView {...props} />);
    await user.type(input(), "Shorter{Enter}");
    await apply(user);
    expect(toast).toHaveBeenCalledWith("I'm still working on your last message.");
    expect(within(panel()).getByRole("region", { name: "Changes to make" })).toHaveTextContent("Shorter");
  });

  it("offers Retry when the reply fails", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.type(input(), "Shorter{Enter}");
    await apply(user);
    report({ id: "reply-1", type: "refine", status: "FAILED", error: "The AI server didn't answer in time." });
    expect(toast).toHaveBeenLastCalledWith("The AI server didn't answer in time.", { action: expect.objectContaining({ label: "Retry" }) });
    await act(async () => vi.mocked(toast).mock.lastCall?.[1]?.action?.onClick());
    expect(retry).toHaveBeenCalledWith({ id: "reply-1" });
    expect(within(panel()).getByText("Thinking…")).toBeInTheDocument();
  });

  it("keeps thinking about a reply started before a reload", () => {
    render(<ApplicationView {...props} refining="reply-7" />);
    expect(within(panel()).getByText("Thinking…")).toBeInTheDocument();
  });

  it("answers on the Conversation tab without a document", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} aiReady={false} initialTab="conversation" />);
    await user.type(input(), "Change the salary{Enter}");
    await apply(user);
    expect(sendMessage).toHaveBeenCalledWith({ id: "app-1", text: "Change the salary", viewing: null, target: null });
  });

  it("points to Settings without an AI provider", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} aiReady={false} />);
    expect(within(panel()).getByRole("link", { name: "Choose one in Settings" })).toHaveAttribute("href", "/settings?section=ai");
    await user.type(input(), "Shorter{Enter}");
    await apply(user);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("undoing an AI change (E8-6)", () => {
  const replyWith = (extra: object) => ({
    id: "m3",
    role: "AI" as const,
    text: "Trimmed your summary.",
    targetUnit: null,
    opening: false,
    canUndo: true,
    undone: false,
    ...extra,
  });
  const log = () => screen.getByRole("log", { name: "Conversation" });

  it("offers Undo under a reply that changed something", () => {
    render(
      <ApplicationView
        {...props}
        messages={[replyWith({}), replyWith({ id: "m4", text: "Your profile doesn't mention that.", canUndo: false })]}
      />,
    );
    expect(within(log()).getAllByRole("button", { name: "Undo" })).toHaveLength(1);
  });

  it("puts the change back, marks the units and says Undone", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} messages={[replyWith({})]} />);
    await user.click(within(log()).getByRole("button", { name: "Undo" }));
    expect(undoMessage).toHaveBeenCalledWith({ id: "app-1", messageId: "m3" });
    expect(screen.getByRole("group", { name: "Summary" }).className).toMatch(/flash/);
  });

  it("stays Undone after a reload", () => {
    render(<ApplicationView {...props} messages={[replyWith({ undone: true })]} />);
    expect(within(log()).getByText("Undone")).toBeInTheDocument();
    expect(within(log()).queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("explains when it can't undo", async () => {
    const user = userEvent.setup();
    const why = "You've changed the summary since, so undoing this would overwrite that. Edit it by hand instead.";
    vi.mocked(undoMessage).mockResolvedValueOnce({ ok: false, error: why });
    render(<ApplicationView {...props} messages={[replyWith({})]} />);
    await user.click(within(log()).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(why));
    // Back once the action has finished.
    expect(await within(log()).findByRole("button", { name: "Undo" })).toBeInTheDocument();
  });
});

describe("the Job posting tab (E8-7)", () => {
  const requirements = [
    { text: "Strong prototyping skills in Figma", kind: "skill" as const, skill: "Figma", years: null, language: null },
    { text: "Experience with Kubernetes", kind: "skill" as const, skill: "Kubernetes", years: null, language: null },
  ];
  const match = {
    items: [
      { requirement: requirements[0].text, result: "covered" as const, skill: "Figma", experienceIds: ["e2"], note: "Used at Fieldnote" },
      { requirement: requirements[1].text, result: "gap" as const, skill: null, experienceIds: [], note: "Not in your profile" },
    ],
  };
  const open = (extra: Partial<ApplicationViewProps> = {}) =>
    render(<ApplicationView {...props} match={match} requirements={requirements} initialTab="posting" {...extra} />);

  it("shows how the profile matches, then the posting as pasted", () => {
    open();
    expect(screen.getByRole("heading", { name: "How you match" })).toBeInTheDocument();
    expect(screen.getByText("1 of 2 covered by your profile")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Requirements" })).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Original posting" })).toBeInTheDocument();
    expect(screen.getByText(/^Ledgerly is hiring\./)).toHaveClass("whitespace-pre-wrap");
    expect(screen.getByText("Pasted 27 Sep")).toBeInTheDocument();
  });

  it("adds a missing skill to the profile", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "+ Add to profile" }));
    expect(addMatchSkill).toHaveBeenCalledWith({ id: "app-1", index: 1 });
    expect(toast).toHaveBeenCalledWith("Added “Kubernetes” to your skills. Attach it to a role under Experience to make it count.");
  });

  it("links to the saved posting in a new tab", () => {
    open({ posting: { ...props.posting, url: "https://jobs.ledgerly.com/senior-designer" } });
    const link = within(screen.getByRole("tabpanel")).getByRole("link", { name: "jobs.ledgerly.com/senior-designer (opens in a new tab)" });
    expect(link).toHaveAttribute("href", "https://jobs.ledgerly.com/senior-designer");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows only the posting when it wasn't matched", () => {
    open({ match: null });
    expect(screen.queryByRole("heading", { name: "How you match" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("tabpanel")).queryByRole("link", { name: /opens in a new tab/ })).not.toBeInTheDocument();
  });
});

describe("downloading (E8-8)", () => {
  it("has one Download button offering PDF or Word", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} />);
    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["PDF", "Word"]);
  });

  it("isn't offered without documents", () => {
    render(<ApplicationView {...props} resume={null} letter={null} />);
    expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
  });
});

describe("activity (E8-9, application history)", () => {
  const at = "2026-10-03T13:00:00.000Z";
  const sent = [
    { id: "s1", kind: "RESUME" as const, label: "Resume" },
    { id: "s2", kind: "COVER_LETTER" as const, label: "Cover letter" },
  ];
  const activity = [
    { kind: "note" as const, id: "n1", noteKind: "CALL" as const, body: "Called John.\n- Second round next week\n- Bring a portfolio", date: "Sat 3 Oct, 15:00", at, edited: false },
    { kind: "status" as const, id: "e2", status: "INTERVIEW" as const, date: "Sat 3 Oct, 09:00", at: "2026-10-03T07:00:00.000Z", sent: [] },
    { kind: "note" as const, id: "n2", noteKind: "NOTE" as const, body: "Sent a thank-you.", date: "Thu 1 Oct, 10:00", at: "2026-10-01T08:00:00.000Z", edited: true },
    { kind: "status" as const, id: "e1", status: "SENT" as const, date: "Thu 1 Oct, 09:00", at: "2026-10-01T07:00:00.000Z", sent },
    { kind: "created" as const, id: "created" as const, date: "Mon 28 Sep, 18:00", at: "2026-09-28T16:00:00.000Z" },
  ];
  const open = () => render(<ApplicationView {...props} activity={activity} initialTab="notes" />);
  const timeline = () => screen.getByRole("list", { name: "Events and notes" });

  beforeEach(() => {
    vi.mocked(addNote).mockClear();
    vi.mocked(updateNote).mockClear();
    vi.mocked(deleteNote).mockClear();
    vi.mocked(restoreNote).mockClear();
    vi.mocked(recordSend).mockClear();
  });

  it("has an Events / Notes tab with the number of entries, and an Activity timeline beside it", () => {
    open();
    expect(screen.getByRole("tab", { name: "Events / Notes · 2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Activity" })).toBeInTheDocument();
    expect(screen.getByText("Private and never sent to the AI")).toBeInTheDocument();
  });

  it("shows entries, status changes and what was sent in one timeline, newest first", () => {
    open();
    const items = within(timeline()).getAllByRole("listitem", { name: (_, element) => element.parentElement === timeline() });
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent("Call");
    expect(within(items[0]).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Second round next week", "Bring a portfolio"]);
    expect(items[3]).toHaveTextContent("Moved to Applied");
    expect(within(items[3]).getByRole("list", { name: "What you applied with" })).toHaveTextContent("Resume you applied with");
    expect(within(items[3]).getByRole("link", { name: "Word file of the cover letter you applied with" })).toHaveAttribute("href", "/api/docx?doc=sent&sent=s2");
    expect(within(items[3]).getByRole("link", { name: "PDF of the resume you applied with" })).toHaveAttribute("href", "/api/pdf?doc=sent&sent=s1");
  });

  it("adds a call", async () => {
    const user = userEvent.setup();
    open();
    await user.selectOptions(screen.getByLabelText("Reason"), "CALL");
    await user.type(screen.getByLabelText("Add an event"), "Recruiter said salary is flexible.");
    await user.click(screen.getByRole("button", { name: "Add event" }));
    // Dated the moment it's added: there's no date to pick.
    expect(addNote).toHaveBeenCalledWith({ id: "app-1", body: "Recruiter said salary is flexible.", kind: "CALL" });
    expect(screen.queryByLabelText("When")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Add an event")).toHaveValue("");
  });

  it("edits an entry in place", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "Edit the entry from Thu 1 Oct, 10:00" }));
    const box = screen.getByRole("textbox", { name: "Edit entry" });
    expect(box).toHaveFocus();
    await user.type(box, " And a follow-up.");
    await user.click(within(timeline()).getByRole("button", { name: "Save" }));
    expect(updateNote).toHaveBeenCalledWith(expect.objectContaining({ id: "app-1", noteId: "n2", body: "Sent a thank-you. And a follow-up.", kind: "NOTE" }));
    expect(new Date(vi.mocked(updateNote).mock.lastCall![0].at!).toISOString()).toBe("2026-10-01T08:00:00.000Z");
  });

  it("deletes an entry with Undo on the toast", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "Delete the entry from Sat 3 Oct, 15:00" }));
    expect(deleteNote).toHaveBeenCalledWith({ id: "app-1", noteId: "n1" });
    expect(toast).toHaveBeenLastCalledWith("Entry deleted.", { action: expect.objectContaining({ label: "Undo" }) });
    await act(async () => vi.mocked(toast).mock.lastCall?.[1]?.action?.onClick());
    expect(restoreNote).toHaveBeenCalledWith({ id: "app-1", body: "Called John.", kind: "CALL", at, createdAt: at, updatedAt: at });
  });

  it("doesn't ask where else it was sent", () => {
    open();
    expect(screen.queryByLabelText("Where it went")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record a send" })).not.toBeInTheDocument();
  });

  it("keeps the refine panel to the documents", () => {
    open();
    expect(screen.queryByRole("complementary", { name: "Refine with AI" })).not.toBeInTheDocument();
  });

  it("tells the whole story oldest first on the Activity tab, with the waits between", () => {
    render(<ApplicationView {...props} activity={activity} initialTab="activity" />);
    // The timeline's own steps, not the bullet points inside an entry.
    const steps = [...screen.getByRole("list", { name: "Timeline" }).children];
    expect(steps[0]).toHaveTextContent("Application created");
    expect(steps[1]).toHaveTextContent("Waited 2 days");
    expect(steps[1]).toHaveTextContent("Applied");
    expect(steps.at(-2)).toHaveTextContent("Called John.");
  });
});

describe("one-page trimming on the Resume tab (E10-10)", () => {
  it("lists what was left out, each with Put back", async () => {
    const user = userEvent.setup();
    const trimmed = [
      { kind: "unit" as const, unit: { id: "experience:e3", label: "Studio Brik role", text: "Built things" }, index: 3 },
      { kind: "bullets" as const, unitId: "experience:e2", label: "Fieldnote role", lines: ["Ran research"] },
    ];
    render(<ApplicationView {...props} resume={{ units: demoResumeUnits(), theme: theme("editorial"), trimmed }} />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Trimmed to fit the page limit:Studio Brik rolePut back1 bullet from the Fieldnote rolePut back");
    await user.click(within(note).getByRole("button", { name: "Put back 1 bullet from the Fieldnote role" }));
    expect(putBackTrimmed).toHaveBeenCalledWith({ id: "app-1", index: 1 });
    expect(toast).toHaveBeenLastCalledWith("Put back. The resume may run over its page limit now.");
  });

  it("lists parts left out by hand with them, and says which the page limit left out (#217)", async () => {
    const user = userEvent.setup();
    const trimmed = [
      { kind: "unit" as const, unit: { id: "experience:e3", label: "Studio Brik role", text: "Built things" }, index: 3 },
      { kind: "unit" as const, unit: { id: "languages", label: "Languages", text: "Dutch: Native" }, index: 9, byHand: true as const },
    ];
    render(<ApplicationView {...props} resume={{ units: demoResumeUnits(), theme: theme("editorial"), trimmed }} />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Left out of this resume:Studio Brik role · to fit the page limitPut backLanguagesPut back");
    await user.click(within(note).getByRole("button", { name: "Put back the Languages" }));
    expect(putBackTrimmed).toHaveBeenCalledWith({ id: "app-1", index: 1 });
    expect(toast).toHaveBeenLastCalledWith("Put back.");
  });

  it("says nothing when nothing was left out", () => {
    render(<ApplicationView {...props} />);
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

describe("version history (E8-10)", () => {
  const written = { id: "v1", cause: "WRITTEN" as const, detail: "", createdAt: "2026-09-29T08:05:00.000Z" };
  const refined = { id: "v2", cause: "REFINED" as const, detail: "Make it shorter", createdAt: "2026-09-29T09:10:00.000Z" };

  it("lists the versions with why and when, and says when there are none", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ApplicationView {...props} />);
    await user.click(screen.getAllByRole("button", { name: "History" })[0]);
    expect(await screen.findByText("No versions yet. The next AI change saves the first one.")).toBeInTheDocument();
    expect(listVersions).toHaveBeenCalledWith({ id: props.application.id, document: "RESUME" });
    unmount();

    vi.mocked(listVersions).mockResolvedValueOnce({ ok: true, data: [refined, written] });
    render(<ApplicationView {...props} />);
    await user.click(screen.getAllByRole("button", { name: "History" })[0]);
    const list = await screen.findByRole("list", { name: "Versions" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Changed from the chat: “Make it shorter”");
    expect(items[0]).toHaveTextContent("· the newest");
    expect(items[1]).toHaveTextContent("Written by the AI");
  });

  it("shows an earlier version in place, restores it, or goes back", async () => {
    const user = userEvent.setup();
    vi.mocked(listVersions).mockResolvedValue({ ok: true, data: [written] });
    const older = demoResumeUnits().map((unit) => (unit.id === "summary" ? { ...unit, text: "An older summary." } : unit));
    vi.mocked(loadVersion).mockResolvedValue({ ok: true, data: { document: "RESUME", units: older } });
    render(<ApplicationView {...props} />);

    await user.click(screen.getAllByRole("button", { name: "History" })[0]);
    await user.click(await screen.findByRole("button", { name: /^Look at the version from/ }));
    expect(loadVersion).toHaveBeenCalledWith({ id: props.application.id, versionId: "v1" });
    expect(screen.getByRole("note")).toHaveTextContent("You're looking at the version from");
    expect(screen.getByRole("note")).toHaveTextContent("Written by the AI.");
    expect(screen.getByText("An older summary.")).toBeInTheDocument();
    // No editing tools on an earlier version.
    expect(screen.queryByRole("button", { name: "Regenerate" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to the current one" }));
    expect(screen.queryByText("An older summary.")).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "History" })[0]);
    await user.click(await screen.findByRole("button", { name: /^Look at the version from/ }));
    await user.click(screen.getByRole("button", { name: "Restore this version" }));
    expect(restoreVersion).toHaveBeenCalledWith({ id: props.application.id, versionId: "v1" });
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Restore this version" })).not.toBeInTheDocument();
  });
});

describe("the Email tab", () => {
  const email = [
    { id: "to", label: "Recipient", text: "John Doe <john@example.com>" },
    { id: "subject", label: "Subject", text: "Application: Senior Product Designer, Jane Doe" },
    { id: "body", label: "Message", text: "Dear John,\n\nI'd love to bring calm to Ledgerly's payments.\n\nWarm regards,\nJane Doe" },
  ];
  const toastAction = () => vi.mocked(toast).mock.lastCall?.[1]?.action;
  const panel = () => screen.getByRole("complementary", { name: "Refine with AI" });

  it("offers to write the email, then shows it", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ApplicationView {...props} initialTab="email" />);
    await user.click(screen.getByRole("button", { name: "Write the email" }));
    expect(startWritingEmail).toHaveBeenCalledWith({ id: "app-1" });
    expect(screen.getByRole("button", { name: "Writing the email…" })).toHaveAttribute("aria-disabled", "true");

    report({ id: "email-1", type: "write-email", status: "DONE", result: { units: email, previous: null } });
    expect(router.refresh).toHaveBeenCalled();
    // The first email just appears.
    expect(toast).not.toHaveBeenCalled();
    rerender(<ApplicationView {...props} initialTab="email" email={email} />);
    const article = screen.getByRole("article", { name: "Email" });
    expect(within(article).getByRole("group", { name: "Recipient" })).toHaveTextContent("John Doe <john@example.com>");
    expect(within(article).getByRole("group", { name: "Subject" })).toHaveTextContent("Application: Senior Product Designer, Jane Doe");
    expect(within(article).getByRole("group", { name: "Message" })).toHaveTextContent("I'd love to bring calm to Ledgerly's payments.");
  });

  it("points to Settings without an AI provider", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} initialTab="email" aiReady={false} />);
    await user.click(screen.getByRole("button", { name: "Write the email" }));
    expect(startWritingEmail).not.toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith("That needs an AI provider. Choose one in Settings → AI provider.", {
      action: expect.objectContaining({ label: "Open Settings" }),
    });
  });

  it("keeps writing one started before a reload", () => {
    render(<ApplicationView {...props} initialTab="email" writingEmail="email-7" />);
    expect(screen.getByRole("button", { name: "Writing the email…" })).toBeInTheDocument();
  });

  it("copies each part and opens the email in the mail app", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} initialTab="email" email={email} />);
    await user.click(screen.getByRole("button", { name: "Copy the recipient" }));
    expect(copyText).toHaveBeenLastCalledWith("John Doe <john@example.com>");
    await user.click(screen.getByRole("button", { name: "Copy the subject" }));
    expect(copyText).toHaveBeenLastCalledWith("Application: Senior Product Designer, Jane Doe");
    expect(toast).toHaveBeenLastCalledWith("Copied the subject.");
    await user.click(screen.getByRole("button", { name: "Copy message" }));
    expect(copyText).toHaveBeenLastCalledWith(email[2].text);

    const mailto = screen.getByRole("link", { name: "Open in mail app" }).getAttribute("href")!;
    expect(mailto).toMatch(/^mailto:john@example\.com\?subject=Application%3A%20Senior/);
    expect(mailto).toContain("body=Dear%20John%2C%0D%0A%0D%0AI'd%20love");
  });

  it("lists the resume and cover letter to attach, each with its download", () => {
    render(<ApplicationView {...props} initialTab="email" email={email} />);
    expect(screen.getByRole("link", { name: "Download Jane Doe – Ledgerly – Resume.pdf" })).toHaveAttribute(
      "href",
      "/api/pdf?doc=resume&application=app-1",
    );
    expect(screen.getByRole("link", { name: "Download Jane Doe – Ledgerly – Cover letter.pdf" })).toHaveAttribute(
      "href",
      "/api/pdf?doc=letter&application=app-1",
    );
  });

  it("says when the posting gives no address, and only edits the recipient", () => {
    render(<ApplicationView {...props} initialTab="email" email={[{ ...email[0], text: "" }, email[1], email[2]]} />);
    const recipient = screen.getByRole("group", { name: "Recipient" });
    expect(recipient).toHaveTextContent("The posting doesn't give an address. Edit to add one.");
    expect(within(recipient).getAllByRole("button").map((button) => button.textContent)).toEqual(["Edit"]);
    expect(screen.queryByRole("button", { name: "Copy the recipient" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Subject" })).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Edit",
      "Regenerate",
      "Ask AI",
    ]);
  });

  it("rewrites it, with Undo on the toast", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} initialTab="email" email={email} />);
    await user.click(screen.getByRole("button", { name: "Rewrite" }));
    expect(startWritingEmail).toHaveBeenCalledWith({ id: "app-1" });
    expect(screen.getByRole("article", { name: "Email" })).toHaveAttribute("aria-busy", "true");

    report({ id: "email-1", type: "write-email", status: "DONE", result: { units: email, previous: email } });
    expect(screen.getByRole("group", { name: "Message" }).className).toMatch(/flash/);
    expect(toast).toHaveBeenLastCalledWith("Rewrote the email.", { action: expect.objectContaining({ label: "Undo" }) });
    await act(async () => toastAction()?.onClick());
    expect(undoEmailRewrite).toHaveBeenCalledWith({ id: "app-1", jobId: "email-1" });
    expect(toast).toHaveBeenLastCalledWith("Put the email back.");
  });

  it("offers Retry when writing fails", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} initialTab="email" />);
    await user.click(screen.getByRole("button", { name: "Write the email" }));
    report({ id: "email-1", type: "write-email", status: "FAILED", error: "The AI server didn't answer in time." });
    expect(screen.getByRole("button", { name: "Write the email" })).toBeInTheDocument();
    expect(toast).toHaveBeenLastCalledWith("The AI server didn't answer in time.", { action: expect.objectContaining({ label: "Retry" }) });
    await act(async () => toastAction()?.onClick());
    expect(retry).toHaveBeenCalledWith({ id: "email-1" });
    expect(screen.getByRole("button", { name: "Writing the email…" })).toBeInTheDocument();
  });

  it("refines the email from the chat once there is one", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ApplicationView {...props} initialTab="email" />);
    expect(within(panel()).queryByRole("button", { name: "Shorter, under 100 words" })).not.toBeInTheDocument();
    unmount();

    render(<ApplicationView {...props} initialTab="email" email={email} />);
    expect(within(panel()).getByText(/^Ask for changes to your email/)).toBeInTheDocument();
    await user.click(within(panel()).getByRole("button", { name: "Shorter, under 100 words" }));
    await user.click(within(panel()).getByRole("button", { name: /^Apply/ }));
    expect(sendMessage).toHaveBeenCalledWith({ id: "app-1", text: "Shorter, under 100 words", viewing: "EMAIL", target: null });
  });

  it("switches to the email when a reply changed it", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} email={email} />);
    await user.type(screen.getByRole("textbox", { name: "Ask for a change" }), "Make the email shorter{Enter}");
    await user.click(within(panel()).getByRole("button", { name: /^Apply/ }));
    report({ id: "reply-1", type: "refine", status: "DONE", result: { messageId: "m9", edited: [{ document: "EMAIL", unitId: "body" }] } });
    expect(screen.getByRole("tab", { name: "Email" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("group", { name: "Message" }).className).toMatch(/flash/);
  });

  it("has a history of its own", async () => {
    const user = userEvent.setup();
    render(<ApplicationView {...props} initialTab="email" email={email} />);
    await user.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByRole("heading", { name: "History of the email" })).toBeInTheDocument();
    expect(listVersions).toHaveBeenLastCalledWith({ id: "app-1", document: "EMAIL" });
  });
});
