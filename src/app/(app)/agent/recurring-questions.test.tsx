import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { answerRecurringQuestion, decideRecurringQuestion } from "./actions";
import { RecurringQuestions } from "./recurring-questions";

vi.mock("./actions", () => ({
  answerRecurringQuestion: vi.fn(async () => ({ ok: true, data: { where: "your Project Manager role at Northwind role", started: 1 } })),
  decideRecurringQuestion: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const question = {
  topic: "HIPAA / protected health information",
  roleId: "northwind",
  roleLabel: "Project Manager at Northwind",
  guess: "Handled PHI under HIPAA in claims EDI work.",
  drafts: [
    { applicationId: "acme", company: "Acme Health", text: "Name HIPAA." },
    { applicationId: "globex", company: "Globex", text: "Mention PHI." },
  ],
};
const roles = [{ id: "northwind", label: "Project Manager at Northwind" }];

describe("Questions that keep coming up", () => {
  it("answers once: the fact in its role, added to the drafts still ticked", async () => {
    const user = userEvent.setup();
    render(<RecurringQuestions questions={[question]} roles={roles} />);
    await user.click(screen.getByRole("button", { name: /Click here to review and fix/ }));
    expect(screen.getByText("Asked by 2 drafts: Acme Health, Globex")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Yes, it's true" }));
    expect(screen.getByRole("textbox", { name: "What's true, in your words" })).toHaveValue(question.guess);
    expect(screen.getByRole("combobox", { name: "Add to" })).toHaveValue("northwind");
    await user.click(screen.getByRole("checkbox", { name: "Globex" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(answerRecurringQuestion).toHaveBeenCalledWith({ topic: question.topic, text: question.guess, target: "northwind", applicationIds: ["acme"] });
  });

  it("puts one away as not true, for later, or for good", async () => {
    const user = userEvent.setup();
    render(<RecurringQuestions questions={[question]} roles={roles} />);
    await user.click(screen.getByRole("button", { name: /Click here to review and fix/ }));
    await user.click(screen.getByRole("button", { name: "Not true" }));
    expect(decideRecurringQuestion).toHaveBeenLastCalledWith({ topic: question.topic, state: "not-true" });
    await user.click(screen.getByRole("button", { name: "Later" }));
    expect(decideRecurringQuestion).toHaveBeenLastCalledWith({ topic: question.topic, state: "later" });
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(decideRecurringQuestion).toHaveBeenLastCalledWith({ topic: question.topic, state: "dismissed" });
  });

  it("stays folded until opened, then shows three at a time", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 7 }, (_, index) => ({ ...question, topic: `Topic ${index + 1}` }));
    render(<RecurringQuestions questions={many} roles={roles} />);
    expect(screen.getByText("7 items")).toBeInTheDocument();
    expect(screen.queryByText("Topic 1")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Click here to review and fix/ }));
    expect(screen.getAllByRole("button", { name: "Yes, it's true" })).toHaveLength(3);
    expect(screen.getByText("1–3 of 7")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Topic 7")).toBeInTheDocument();
    expect(screen.getByText("7–7 of 7")).toBeInTheDocument();
  });

  it("shows nothing when nothing repeats", () => {
    const { container } = render(<RecurringQuestions questions={[]} roles={roles} />);
    expect(container).toBeEmptyDOMElement();
  });
});
