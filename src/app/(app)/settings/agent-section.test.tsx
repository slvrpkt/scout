import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";

import { addAgentSearch, changeAgentSearch, removeAgentSearch, saveAgentSettings } from "../agent/actions";
import { AgentSection, type AgentSettings } from "./agent-section";

vi.mock("../agent/actions", () => ({
  saveAgentSettings: vi.fn(async () => ({ ok: true, data: null })),
  addAgentSearch: vi.fn(async () => ({ ok: true, data: { id: "search-new", maxPages: 5 } })),
  changeAgentSearch: vi.fn(async () => ({ ok: true, data: null })),
  removeAgentSearch: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: { ok: boolean; error?: string }) => (result.ok ? result : (toast(result.error!), result)) }));

const query = { keywords: "Data scientist", place: "Berlin", country: "de", radiusKm: 25 as const, remoteOnly: false, postedWithin: "any" as const };
const initial: AgentSettings = {
  enabled: false,
  times: ["07:00"],
  minScore: 70,
  dailyScores: 150,
  dailyDrafts: 30,
  autoDraft: false, scoreShares: [], draftShares: [], draftScore: 80, dailyGoal: 150, titleSkip: [] 
};
const countries = [
  { code: "de", name: "Germany" },
  { code: "nl", name: "Netherlands" },
];
const open = (props: Partial<Parameters<typeof AgentSection>[0]> = {}) =>
  render(
    <AgentSection
      initial={initial}
      searches={[{ id: "search-1", query, enabled: true, maxPages: 5, skipRules: "", places: "" }]}
      maxSearches={20}
      maxPages={5}
      startFrom={query}
      source="JSEARCH"
      scoring={{ scorer: "AI", ready: true }}
      countries={countries}
      timeZone="Europe/Berlin"
      {...props}
    />,
  );

beforeEach(() => vi.clearAllMocks());

describe("Settings → Job agent (E16-7)", () => {
  it("is off until it's turned on", async () => {
    const user = userEvent.setup();
    open();
    const toggle = screen.getByRole("switch", { name: "Run the job agent" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleDescription("Off. Nothing is searched or scored until it's on.");
    await user.click(toggle);
    expect(saveAgentSettings).not.toHaveBeenCalled();
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(within(screen.getByRole("alertdialog", { name: "Turn on the job agent?" })).getByRole("button", { name: "Cancel" }));
    expect(saveAgentSettings).not.toHaveBeenCalled();
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "Turn on" }));
    expect(saveAgentSettings).toHaveBeenCalledWith({ enabled: true });
    expect(toggle).toHaveAccessibleDescription(/^On\. It runs at 7:00 AM your time \(Europe\/Berlin\)/);
  });

  it("needs keywords and a country to include a search in runs", async () => {
    const user = userEvent.setup();
    open({ searches: [{ id: "search-1", query: { ...query, keywords: "", country: "" }, enabled: false, maxPages: 5, skipRules: "", places: "" }] });
    await user.click(screen.getByRole("switch", { name: "Disabled" }));
    expect(changeAgentSearch).not.toHaveBeenCalled();
    expect(screen.getByLabelText("What")).toHaveAccessibleDescription("Type what this search should look for.");
    expect(screen.getByLabelText("Country")).toHaveAccessibleDescription("Choose a country.");
  });

  it("calls the switch Enabled or Disabled, at the top of the card", () => {
    open();
    const card = screen.getByRole("region", { name: "Search 1" });
    expect(within(card).getByRole("switch", { name: "Enabled" })).toHaveAttribute("aria-checked", "true");
    expect(within(card).queryByText("Include in runs")).not.toBeInTheDocument();
  });

  it("sets Add search apart under the agent's switch, and groups what applies to all searches", () => {
    open();
    const add = screen.getByRole("button", { name: "Add search" });
    const first = screen.getByRole("region", { name: "Search 1" });
    expect(add.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("1 of 20 searches")).toBeInTheDocument();
    const all = screen.getByRole("region", { name: "Applies to all searches" });
    expect(within(all).getByText("When it runs")).toBeInTheDocument();
    expect(within(all).getByLabelText("Minimum score")).toBeInTheDocument();
  });

  it("adds what to skip from a popup, as tags, and removes them", async () => {
    const user = userEvent.setup();
    open();
    const add = async (rule: string) => {
      await user.click(screen.getByRole("button", { name: "Add what to skip" }));
      await user.type(within(screen.getByRole("dialog")).getByLabelText("Skip jobs when"), rule);
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add" }));
    };
    await add("PMP certification is required");
    expect(changeAgentSearch).toHaveBeenLastCalledWith({ id: "search-1", skipRules: "PMP certification is required" });
    await add("Security clearance is required");
    expect(changeAgentSearch).toHaveBeenLastCalledWith({ id: "search-1", skipRules: "PMP certification is required\nSecurity clearance is required" });
    expect(screen.getByText("Security clearance is required")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove PMP certification is required" }));
    expect(changeAgentSearch).toHaveBeenLastCalledWith({ id: "search-1", skipRules: "Security clearance is required" });
  });

  it("opens the popup from anywhere in the What to skip box, but not from a tag's ×", async () => {
    const user = userEvent.setup();
    open({ searches: [{ id: "search-1", query, enabled: true, maxPages: 5, skipRules: "PMP", places: "" }] });
    await user.click(screen.getByText("PMP").parentElement!);
    expect(screen.getByRole("dialog", { name: "Add what to skip" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Remove PMP" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("adds up to ten locations as tags, with no Within", async () => {
    const user = userEvent.setup();
    open({ searches: [{ id: "search-1", query, enabled: true, maxPages: 5, skipRules: "", places: "A\nB\nC\nD\nE\nF\nG\nH\nI" }] });
    expect(screen.queryByLabelText("Within")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "C" })).toHaveAttribute("href", expect.stringContaining("where=C"));
    await user.click(screen.getByRole("button", { name: "Add a location" }));
    await user.type(screen.getByLabelText("Location"), "Maryland");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add" }));
    expect(changeAgentSearch).toHaveBeenLastCalledWith({ id: "search-1", places: "A\nB\nC\nD\nE\nF\nG\nH\nI\nMaryland" });
    expect(screen.getByText("You've reached the maximum of 10 locations.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a location" })).not.toBeInTheDocument();
  });

  it("adds a search copying everything from the one before but the job title and what to skip, and removes one", async () => {
    const user = userEvent.setup();
    const filtered = { ...query, workModes: ["hybrid" as const], minSalary: 120000 };
    open({ searches: [{ id: "search-1", query: filtered, enabled: true, maxPages: 3, skipRules: "Intern", places: "Rockville, MD\nReston, VA" }] });
    await user.click(screen.getByRole("button", { name: "Add search" }));
    expect(addAgentSearch).toHaveBeenCalledWith({ query: { ...filtered, keywords: "" } });
    expect(changeAgentSearch).toHaveBeenCalledWith({ id: "search-new", places: "Rockville, MD\nReston, VA", maxPages: 3 });
    const added = await screen.findByRole("region", { name: "Search 2" });
    expect(within(added).getByText("Rockville, MD")).toBeInTheDocument();
    expect(within(added).queryByText("Intern")).not.toBeInTheDocument();
    expect(screen.getByText("2 of 20 searches")).toBeInTheDocument();
    await user.click(within(screen.getByRole("region", { name: "Search 1" })).getByRole("button", { name: "Remove search 1" }));
    expect(removeAgentSearch).toHaveBeenCalledWith({ id: "search-1" });
    expect(screen.getAllByRole("region", { name: /^Search \d$/ })).toHaveLength(1);
  });

  it("folds the other searches into tiles when one is added, and opens a tile when it's clicked", async () => {
    const user = userEvent.setup();
    open({ searches: [{ id: "search-1", query, enabled: true, maxPages: 5, skipRules: "", places: "Rockville, MD" }] });
    expect(screen.getByLabelText("What")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add search" }));
    const first = await screen.findByRole("region", { name: "Search 1" });
    // The first is a tile now: its title and where it looks, without its fields.
    expect(within(first).getByText("· Data scientist")).toBeInTheDocument();
    expect(within(first).getByText("Rockville, MD")).toBeInTheDocument();
    expect(within(first).queryByLabelText("What")).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Search 2" })).getByLabelText("What")).toHaveValue("");
    await user.click(within(first).getByRole("button", { name: "Edit" }));
    expect(within(screen.getByRole("region", { name: "Search 1" })).getByLabelText("What")).toHaveValue("Data scientist");
    expect(within(screen.getByRole("region", { name: "Search 2" })).queryByLabelText("What")).not.toBeInTheDocument();
  });

  it("adds up to five alternative titles from a link under What", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "+ Add alternative titles" }));
    await user.click(screen.getByRole("button", { name: "Add an alternative title" }));
    await user.type(screen.getByLabelText("Alternative title"), "TPM");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add" }));
    expect(changeAgentSearch).toHaveBeenLastCalledWith({ id: "search-1", altTitles: "TPM" });
  });

  it("shows run times in 12-hour time", () => {
    open();
    const run = screen.getByLabelText("Run 1") as HTMLSelectElement;
    expect(run.selectedOptions[0].textContent).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
  });

  it("saves a search once typing pauses, and the other choices at once", async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText("What"), " NLP");
    await waitFor(() => expect(changeAgentSearch).toHaveBeenLastCalledWith({ id: "search-1", query: { ...query, keywords: "Data scientist NLP" } }), { timeout: 2000 });
    await user.selectOptions(screen.getByLabelText("Run 1"), "09:00");
    expect(saveAgentSettings).toHaveBeenLastCalledWith(expect.objectContaining({ times: ["09:00"] }));
    await user.selectOptions(screen.getByLabelText("Minimum score"), "80 of 100");
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ minScore: 80 });
    await user.selectOptions(screen.getByLabelText("Postings scored a day"), "300");
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ dailyScores: 300 });
  });

  it("prepares no drafts on its own unless asked, and then up to the day's budget", async () => {
    const user = userEvent.setup();
    open();
    expect(screen.getByLabelText("Drafts a day, at most")).toBeDisabled();
    const toggle = screen.getByRole("switch", { name: "Prepare drafts on its own" });
    expect(toggle).toHaveAccessibleDescription("Off. You choose which postings get a draft with Prepare draft.");
    await user.click(toggle);
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ autoDraft: true });
    await user.selectOptions(screen.getByLabelText("Drafts a day, at most"), "50");
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ dailyDrafts: 50 });
    expect(toggle).toHaveAccessibleDescription(/up to 50 drafts a day/);
  });

  it("adds and removes run times, in order", async () => {
    const user = userEvent.setup();
    open({ initial: { ...initial, times: ["04:00", "13:00"] } });
    await user.click(screen.getByRole("button", { name: "Add a run time" }));
    expect(saveAgentSettings).toHaveBeenLastCalledWith(expect.objectContaining({ times: ["04:00", "13:00", "14:00"] }));
    await user.click(screen.getByRole("button", { name: "Remove run 1 (4:00 AM)" }));
    expect(saveAgentSettings).toHaveBeenLastCalledWith(expect.objectContaining({ times: ["13:00", "14:00"] }));
    expect(screen.getByRole("switch", { name: "Run the job agent" })).toBeInTheDocument();
  });

  it("explains the limits in plain words", () => {
    open();
    expect(screen.getByText(/^1 run a day, and at most 3 in any 24 hours with Run now\. Together they score up to 150 postings a day, a fair share from each search\./)).toBeInTheDocument();
  });

  it("points to the source or AI provider while one isn't set up", () => {
    const { unmount } = open({ source: null });
    expect(screen.getByRole("note")).toHaveTextContent("The agent searches the source you choose in Settings → Job search, which is off. Choose one first.");
    expect(screen.getByRole("link", { name: "Settings → Job search" })).toHaveAttribute("href", "/settings?section=jobs");
    unmount();
    open({ scoring: { scorer: "AI", ready: false } });
    expect(screen.getByRole("note")).toHaveTextContent("The agent scores postings with the AI provider in Settings → AI provider, which isn't set up yet. Choose one first.");
    expect(screen.getByRole("link", { name: "Settings → AI provider" })).toHaveAttribute("href", "/settings?section=ai");
  });

  it("asks for the TypeSafe key when Jev scores without one (#274)", () => {
    open({ scoring: { scorer: "JEV", ready: false } });
    expect(screen.getByRole("note")).toHaveTextContent("The agent scores postings with Jev, which needs your TypeSafe key in Settings → Scoring.");
    expect(screen.getByRole("link", { name: "Settings → Scoring" })).toHaveAttribute("href", "/settings?section=scoring");
  });

  it("says it doesn't search the Bundesagentur für Arbeit (#223)", () => {
    open({ source: "ARBEITSAGENTUR" });
    expect(screen.getByRole("note")).toHaveTextContent("The agent doesn't search the Bundesagentur für Arbeit. Choose JSearch, Adzuna or FreeHire in Settings → Job search for it.");
    expect(screen.getByRole("link", { name: "Settings → Job search" })).toHaveAttribute("href", "/settings?section=jobs");
  });

  it("asks before turning it off too", async () => {
    const user = userEvent.setup();
    open({ initial: { ...initial, enabled: true } });
    await user.click(screen.getByRole("switch", { name: "Run the job agent" }));
    expect(screen.getByRole("alertdialog", { name: "Turn off the job agent?" })).toHaveTextContent("Are you sure you want to do this?");
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    expect(saveAgentSettings).toHaveBeenLastCalledWith({ enabled: false });
  });

  it("switches back and says why when a change isn't saved", async () => {
    const user = userEvent.setup();
    vi.mocked(saveAgentSettings).mockResolvedValueOnce({ ok: false, error: "Type what the agent should look for before turning it on." });
    open();
    await user.click(screen.getByRole("switch", { name: "Run the job agent" }));
    await user.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Run the job agent" })).toHaveAttribute("aria-checked", "false"));
    expect(toast).toHaveBeenCalledWith("Type what the agent should look for before turning it on.");
  });
});
