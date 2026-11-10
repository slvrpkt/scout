import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Basics } from "@/lib/profile";

import { saveBasics } from "./actions";
import { BasicsSection } from "./basics-section";

vi.mock("./actions", () => ({ saveBasics: vi.fn(async () => ({ ok: true, data: null })) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));

const empty: Basics = {
  name: "", headline: "", email: "", phone: "", dob: "", website: "",
  address: "", city: "", state: "", zip: "", country: "", linkedin: "", summary: "", showAge: false,
};

function Harness({ initial = empty }: { initial?: Basics }) {
  const [basics, setBasics] = useState(initial);
  return <BasicsSection basics={basics} onChange={setBasics} />;
}

describe("BasicsSection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(saveBasics).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("has every Basics field, labelled, with the optional ones marked (#216)", () => {
    render(<Harness />);
    for (const label of [
      "Full name", "Job title (optional)", "Email (optional)", "Phone (optional)",
      "Street address (optional)", "City (optional)", "State (optional)", "ZIP code (optional)", "Country (optional)", "LinkedIn (optional)", "Portfolio / Personal Website (optional)", "A few lines about you",
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("counts down the characters left in the few lines about you", () => {
    render(<Harness />);
    expect(screen.getByText("5,000 characters left")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("A few lines about you"), { target: { value: "Hello" } });
    expect(screen.getByText("4,995 characters left")).toBeInTheDocument();
  });

  it("autosaves 500 ms after typing stops", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Jane Doe" } });
    await act(async () => vi.advanceTimersByTimeAsync(499));
    expect(saveBasics).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(saveBasics).toHaveBeenCalledWith({ ...empty, name: "Jane Doe" });
  });

  it("saves right away when leaving a field", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("City (optional)"), { target: { value: "Rotterdam" } });
    await act(async () => fireEvent.blur(screen.getByLabelText("City (optional)")));
    expect(saveBasics).toHaveBeenCalledWith({ ...empty, city: "Rotterdam" });
  });

  it("hints at malformed email and web addresses once you leave the field, without blocking the save", async () => {
    render(<Harness />);
    const email = screen.getByLabelText("Email (optional)");
    fireEvent.change(email, { target: { value: "jane@" } });
    expect(email).not.toHaveAccessibleDescription();

    await act(async () => fireEvent.blur(email));
    expect(email).toHaveAccessibleDescription("That doesn't look like an email address yet.");
    expect(saveBasics).toHaveBeenCalledWith({ ...empty, email: "jane@" });

    fireEvent.change(email, { target: { value: "jane.doe@example.com" } });
    expect(email).not.toHaveAccessibleDescription();

    const website = screen.getByLabelText("Portfolio / Personal Website (optional)");
    fireEvent.change(website, { target: { value: "example.com" } });
    await act(async () => fireEvent.blur(website));
    expect(website).not.toHaveAccessibleDescription();
    fireEvent.change(website, { target: { value: "my site" } });
    expect(website).toHaveAccessibleDescription(/doesn't look like a web address/);
  });

});
