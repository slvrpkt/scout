import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { GoogleExpiredDialog } from "./google-expired-dialog";

beforeEach(() => sessionStorage.clear());

describe("GoogleExpiredDialog", () => {
  it("asks to renew, and Later holds for the session", async () => {
    const { unmount } = render(<GoogleExpiredDialog email="me@example.com" />);
    expect(screen.getByRole("dialog", { name: "Renew your Google access" })).toHaveTextContent("me@example.com");
    expect(screen.getByRole("link", { name: "Renew Google access" })).toHaveAttribute("href", "/api/google/connect");
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    unmount();
    render(<GoogleExpiredDialog email="me@example.com" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
