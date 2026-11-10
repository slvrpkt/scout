import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkInbox, disconnectGoogleAccount, saveGoogleSettings } from "@/lib/google/actions";

import { GoogleSection, type GoogleClientView, type GoogleSettings } from "./google-section";

vi.mock("@/lib/google/actions", () => ({
  saveGoogleClient: vi.fn(async () => ({ ok: true, data: { id: "", idState: "none", secretState: "none" } })),
  checkInbox: vi.fn(async () => ({ ok: true, data: null })),
  disconnectGoogleAccount: vi.fn(async () => ({ ok: true, data: null })),
  saveGoogleSettings: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const settings: GoogleSettings = {
  gmailRead: true,
  gmailScope: "known",
  gmailInterval: 10,
  calendarAvailability: true,
  calendarEvents: true,
  calendarId: "primary",
  workDays: [1, 2, 3, 4, 5],
  workStart: "09:00",
  workEnd: "17:00",
  workTimeZone: null,
  slotMinutes: 45,
  bufferMinutes: 15,
  driveBackup: true,
  driveFolderName: "Job search 2026-27",
  driveCombine: false,
};
const redirect = "http://localhost:3000/api/google/callback";
const client: GoogleClientView = { id: "", idState: "none", secretState: "none" };

beforeEach(() => vi.mocked(saveGoogleSettings).mockClear());

describe("GoogleSection (E15-1)", () => {
  it("explains the setup while the server has no Google client", () => {
    render(<GoogleSection client={client} connection={{ status: "not-configured" }} initial={settings} browserTimeZone="Europe/Berlin" redirectUri={redirect} />);
    expect(screen.getByText(redirect)).toBeInTheDocument();
    expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Client secret")).toHaveAttribute("type", "password");
  });

  it("offers to connect", () => {
    render(<GoogleSection client={client} connection={{ status: "disconnected" }} initial={settings} browserTimeZone={null} redirectUri={redirect} />);
    expect(screen.getByRole("link", { name: "Connect Google account" })).toHaveAttribute("href", "/api/google/connect");
  });

  it("saves what's sent to Google Drive once Drive is allowed, in the folder named", async () => {
    const user = userEvent.setup();
    const connected = { status: "connected", email: "jane@gmail.com", canSend: true, canRead: true, canUseCalendar: true, lastSync: null, syncProblem: null } as const;
    const { unmount } = render(
      <GoogleSection client={client} connection={{ ...connected, canUseDrive: false }} initial={settings} browserTimeZone={null} redirectUri={redirect} />,
    );
    expect(screen.getByRole("link", { name: "Allow" })).toHaveAttribute("href", "/api/google/connect?scopes=drive");
    expect(screen.getByRole("switch", { name: /Save What I Send To Google Drive/ })).toBeDisabled();
    unmount();

    render(<GoogleSection client={client} connection={{ ...connected, canUseDrive: true }} initial={settings} browserTimeZone={null} redirectUri={redirect} />);
    const folder = screen.getByRole("textbox", { name: "Folder In Google Drive" });
    expect(folder).toHaveValue("Job search 2026-27");
    await user.clear(folder);
    await user.type(folder, "Job search 2027-28");
    await user.tab();
    expect(saveGoogleSettings).toHaveBeenLastCalledWith({ driveFolderName: "Job search 2027-28" });
    await user.click(screen.getByRole("switch", { name: /Combine Cover Letter And Resume/ }));
    expect(saveGoogleSettings).toHaveBeenLastCalledWith({ driveCombine: true });
  });

  it("saves each choice, links to missing permissions, and disconnects after asking", async () => {
    const user = userEvent.setup();
    render(
      <GoogleSection
        client={client}
        connection={{ status: "connected", email: "jane@gmail.com", canSend: true, canRead: true, canUseCalendar: false, canUseDrive: true, lastSync: "today at 10:00", syncProblem: null }}
        initial={settings}
        browserTimeZone="Europe/Berlin"
        redirectUri={redirect}
      />,
    );
    expect(screen.getByText("jane@gmail.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Allow" })).toHaveAttribute("href", "/api/google/connect?scopes=calendar");
    expect(screen.getByText("Last checked today at 10:00")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Every new email" }));
    expect(saveGoogleSettings).toHaveBeenLastCalledWith({ gmailScope: "all" });
    await user.click(screen.getByRole("button", { name: "Sat" }));
    expect(saveGoogleSettings).toHaveBeenLastCalledWith({ workDays: [1, 2, 3, 4, 5, 6] });
    await user.selectOptions(screen.getByRole("combobox", { name: "Interview length" }), "60");
    expect(saveGoogleSettings).toHaveBeenLastCalledWith({ slotMinutes: 60 });
    // The time zone has its own section now.
    expect(screen.queryByRole("textbox", { name: "Time zone" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings → Time zone" })).toHaveAttribute("href", "/settings?section=timezone");

    await user.click(screen.getByRole("button", { name: "Check now" }));
    expect(checkInbox).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(disconnectGoogleAccount).toHaveBeenCalled();
  });
});
