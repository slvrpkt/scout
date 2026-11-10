import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { toastWithUndo } from "@/components/change-status";
import { toast } from "@/components/toast";
import { checkSending, sendWithGmail } from "@/lib/google/actions";

import { SendWithGmail } from "./send-with-gmail";

vi.mock("@/lib/google/actions", () => ({ checkSending: vi.fn(async () => ({ ok: true, data: { problems: [], unclear: false } })), sendWithGmail: vi.fn(async () => ({ ok: true, data: { eventId: "ev1" }, toast: "Sent." })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/change-status", () => ({ toastWithUndo: vi.fn() }));

const props = { applicationId: "nw", to: "careers@northwind.example", subject: "Application", attachments: ["Jane – Resume.pdf"], sentBefore: false };

describe("SendWithGmail (E15-2)", () => {
  it("says what goes where, and sends once confirmed", async () => {
    const user = userEvent.setup();
    render(<SendWithGmail {...props} sender={{ from: "jane@gmail.com" }} />);
    await user.click(screen.getByRole("button", { name: "Send with Gmail" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Send this application?" });
    expect(dialog).toHaveTextContent("jane@gmail.com");
    expect(dialog).toHaveTextContent("careers@northwind.example");
    expect(dialog).toHaveTextContent("Jane – Resume.pdf");
    await user.click(screen.getByRole("button", { name: "Send now" }));
    expect(sendWithGmail).toHaveBeenCalledWith({ id: "nw", checked: false });
    expect(toastWithUndo).toHaveBeenCalledWith("Sent.", "ev1");
  });

  it("asks for a recipient first", async () => {
    const user = userEvent.setup();
    render(<SendWithGmail {...props} to="" sender={{ from: "jane@gmail.com" }} />);
    await user.click(screen.getByRole("button", { name: "Send with Gmail" }));
    expect(toast).toHaveBeenCalledWith("Add who it's to first: the posting doesn't give an address.");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("points to connecting, or to the missing permission, and hides without a Google client", () => {
    const { rerender, container } = render(<SendWithGmail {...props} sender={{ from: null, reason: "not-connected" }} />);
    expect(screen.getByRole("link", { name: "Connect Gmail to send" })).toHaveAttribute("href", "/settings?section=google");
    rerender(<SendWithGmail {...props} sender={{ from: null, reason: "no-permission" }} />);
    expect(screen.getByRole("link", { name: "Allow sending with Gmail" })).toHaveAttribute("href", "/api/google/connect?scopes=send");
    rerender(<SendWithGmail {...props} sender={{ from: null, reason: "not-configured" }} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("lists what's worth a look before it goes, and an earlier send that stopped halfway", async () => {
    vi.mocked(checkSending).mockResolvedValueOnce({ ok: true, data: { problems: ["The resume runs to 3 pages, over your limit of 2."], unclear: true } } as never);
    const user = userEvent.setup();
    render(<SendWithGmail applicationId="nw" sender={{ from: "jane@gmail.com" }} to="jobs@acme.example" subject="Hello" attachments={[]} sentBefore={false} />);
    await user.click(screen.getByRole("button", { name: "Send with Gmail" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("over your limit of 2");
    expect(dialog).toHaveTextContent("Check your Gmail Sent folder");
    await user.click(screen.getByRole("button", { name: "Send anyway" }));
    expect(sendWithGmail).toHaveBeenLastCalledWith({ id: "nw", checked: true });
  });
});
