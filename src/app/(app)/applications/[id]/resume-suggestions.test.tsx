import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { dismissSuggestion, markSuggestionNotTrue } from "./actions";
import { ResumeSuggestions } from "./resume-suggestions";

vi.mock("./actions", () => ({
  dismissSuggestion: vi.fn(async () => ({ ok: true, data: null })),
  markSuggestionNotTrue: vi.fn(async () => ({ ok: true, data: { topic: "Jira" } })),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));

const jira = "The posting asks for Jira. If you have used it, add it.";
const selc = "Name the SELC documents you wrote in your Consulting role.";

describe("ResumeSuggestions", () => {
  it("lists ideas to vet", () => {
    render(<ResumeSuggestions items={[jira]} />);
    expect(screen.getByRole("region", { name: "Suggestions for this job" })).toHaveTextContent("Jira");
    expect(screen.getByRole("listitem")).toBeInTheDocument();
  });

  it("shows three of many, and the rest on request", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 20 }, (_, index) => `Suggestion ${index + 1}.`);
    render(<ResumeSuggestions items={many} />);
    expect(within(screen.getByRole("list", { name: "Suggestions" })).getAllByRole("listitem")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Show 17 more" }));
    expect(within(screen.getByRole("list", { name: "Suggestions" })).getAllByRole("listitem")).toHaveLength(20);
    await user.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(within(screen.getByRole("list", { name: "Suggestions" })).getAllByRole("listitem")).toHaveLength(3);
  });

  it("stays away when there are none", () => {
    const { container } = render(<ResumeSuggestions items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("dismisses one to the bottom, folded away, and restores it", async () => {
    const user = userEvent.setup();
    render(<ResumeSuggestions id="app-1" items={[jira, selc]} dismissed={[]} />);
    await user.click(screen.getByRole("button", { name: `Dismiss: ${jira}` }));
    expect(dismissSuggestion).toHaveBeenCalledWith({ id: "app-1", text: jira, dismissed: true });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    const fold = screen.getByRole("button", { name: "1 dismissed · Show" });
    expect(fold).toHaveAttribute("aria-expanded", "false");

    await user.click(fold);
    await user.click(screen.getByRole("button", { name: `Restore: ${jira}` }));
    expect(dismissSuggestion).toHaveBeenLastCalledWith({ id: "app-1", text: jira, dismissed: false });
    expect(screen.queryByRole("button", { name: /dismissed ·/ })).not.toBeInTheDocument();
  });

  it("remembers what was dismissed before", () => {
    render(<ResumeSuggestions id="app-1" items={[jira, selc]} dismissed={[jira]} />);
    const list = screen.getAllByRole("list")[0];
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "1 dismissed · Show" })).toBeInTheDocument();
  });

  it("Yes, add it hands the suggestion to the chat; Not true takes it off for good", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<ResumeSuggestions id="app-1" items={[jira, selc]} dismissed={[]} onAdd={onAdd} />);
    const [first, second] = screen.getAllByRole("listitem");
    await user.click(within(first).getByRole("button", { name: "Yes, add it" }));
    expect(onAdd).toHaveBeenCalledWith(jira);
    await user.click(within(second).getByRole("button", { name: "Not true" }));
    expect(markSuggestionNotTrue).toHaveBeenCalledWith({ id: "app-1", text: selc });
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
