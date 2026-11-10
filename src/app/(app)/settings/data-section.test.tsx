import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";

import { deleteEverything, loadSample, removeSample, startZippingPdfs, updateSettings } from "./actions";
import { DataSection, type BackupStatus } from "./data-section";

const backups: BackupStatus = { on: true, retentionDays: 14, dir: "/data/backups", lastRun: "today at 03:00", problem: null, drive: { on: true, allowed: true, folderUrl: null, copies: 0, problem: null } };

vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));
vi.mock("./actions", () => ({
  startZippingPdfs: vi.fn(async () => ({ ok: true, data: { jobId: "zip-1", documents: 12 } })),
  updateSettings: vi.fn(async () => ({ ok: true, data: null })),
  backUpNow: vi.fn(async () => ({ ok: true, data: null })),
  deleteEverything: vi.fn(async () => undefined),
  loadSample: vi.fn(async () => ({ ok: true, data: { applications: 10 }, toast: "Sample data loaded." })),
  removeSample: vi.fn(async () => ({ ok: true, data: { applications: 10 }, toast: "Sample data removed." })),
}));
const noSample = { loaded: false, loadedAt: null, canLoad: true };
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const jobs = vi.hoisted(() => ({ report: undefined as undefined | ((job: unknown) => void) }));
vi.mock("@/hooks/use-job", async () => {
  const { useEffect, useState } = await import("react");
  return {
    useJob: (id: string | null, _revision: number, onChange?: (job: unknown) => void) => {
      const [job, setJob] = useState<unknown>(null);
      useEffect(() => {
        if (id)
          jobs.report = (next) => {
            setJob(next);
            onChange?.(next);
          };
      });
      return id ? job : null;
    },
  };
});

describe("Your data (E10-4)", () => {
  it("exports everything, the API key only when ticked", async () => {
    const user = userEvent.setup();
    render(<DataSection sampleData={noSample} jobRetentionHours={24} hasApiKey exportName="dossier-export-2026-09-28.json" backups={backups} />);
    expect(screen.getByRole("heading", { name: "Export everything" })).toBeInTheDocument();
    const exportLink = screen.getByRole("link", { name: "Export" });
    expect(exportLink).toHaveAttribute("href", "/api/export");

    await user.click(screen.getByRole("checkbox", { name: "Include my API keys" }));
    expect(exportLink).toHaveAttribute("href", "/api/export?apiKey=1");
    expect(screen.getByRole("checkbox")).toHaveAccessibleDescription(/in plain text/);
  });

  it("doesn't offer the API key without one", () => {
    render(<DataSection sampleData={noSample} jobRetentionHours={24} hasApiKey={false} exportName="dossier-export-2026-09-28.json" backups={backups} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("Download all PDFs (E10-5)", () => {
  it("zips in the background, then offers the zip", async () => {
    const user = userEvent.setup();
    render(<DataSection sampleData={noSample} jobRetentionHours={24} hasApiKey={false} exportName="x.json" backups={backups} />);
    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(startZippingPdfs).toHaveBeenCalledWith({});
    expect(toast).toHaveBeenCalledWith("Zipping 12 documents. This takes a moment.");

    act(() => jobs.report?.({ id: "zip-1", type: "zip-pdfs", status: "RUNNING", step: "Rendered 3 of 12", error: null, result: null }));
    expect(screen.getByRole("button", { name: "Zipping…" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Rendered 3 of 12…");

    const result = { file: "f.zip", fileName: "dossier-pdfs-2026-09-28.zip", documents: 12 };
    act(() => jobs.report?.({ id: "zip-1", type: "zip-pdfs", status: "DONE", step: null, error: null, result }));
    expect(screen.getByRole("link", { name: "Download dossier-pdfs-2026-09-28.zip" })).toHaveAttribute("href", "/api/downloads/zip-1");
    expect(toast).toHaveBeenLastCalledWith("dossier-pdfs-2026-09-28.zip is ready.", { action: expect.objectContaining({ label: "Download" }) });
  });

  it("says so when there's nothing to zip", async () => {
    const user = userEvent.setup();
    vi.mocked(startZippingPdfs).mockResolvedValueOnce({ ok: false, error: "There are no tailored documents to download yet." });
    render(<DataSection sampleData={noSample} jobRetentionHours={24} hasApiKey={false} exportName="x.json" backups={backups} />);
    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(toast).toHaveBeenLastCalledWith("There are no tailored documents to download yet.");
  });
});

describe("Import (E10-6)", () => {
  const summary = { applications: 8, roles: 3, skills: 12, themes: 1, notes: 0 };
  const file = new File(["{}"], "dossier-export-2026-09-27.json", { type: "application/json" });

  it("says what the file replaces, then backs up and imports", async () => {
    const user = userEvent.setup();
    const fetch = vi.fn(async (url: string) =>
      url.endsWith("?preview=1")
        ? Response.json({ incoming: summary, current: { ...summary, applications: 10, themes: 0 }, exportedAt: "2026-09-27T10:00:00Z" })
        : Response.json({ incoming: summary, backup: "dossier-backup-before-import-2026-09-28-120000.json" }),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      const { container } = render(<DataSection sampleData={noSample} jobRetentionHours={24} hasApiKey={false} exportName="x.json" backups={backups} />);
      expect(screen.getByRole("button", { name: "Choose file" })).toBeInTheDocument();
      await user.upload(container.querySelector("input[type=file]")!, file);

      const dialog = await screen.findByRole("alertdialog", { name: "Replace everything with this export?" });
      expect(dialog).toHaveTextContent(
        "The file, exported 27 September 2026, has 8 applications, 3 roles, 12 skills and 1 custom theme. It replaces your profile, settings and 10 applications, 3 roles and 12 skills. Your current data is backed up first.",
      );
      await user.click(screen.getByRole("button", { name: "Import and replace" }));
      expect(fetch).toHaveBeenLastCalledWith("/api/import", expect.objectContaining({ method: "POST", body: file }));
      expect(toast).toHaveBeenLastCalledWith("Imported. Your previous data is backed up as dossier-backup-before-import-2026-09-28-120000.json.");
      expect(router.refresh).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows why a file can't be imported", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "That file isn't a Scout export." }, { status: 400 })));
    try {
      const { container } = render(<DataSection sampleData={noSample} jobRetentionHours={24} hasApiKey={false} exportName="x.json" backups={backups} />);
      await user.upload(container.querySelector("input[type=file]")!, file);
      expect(toast).toHaveBeenLastCalledWith("That file isn't a Scout export.");
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses a file over the size limit without sending it", async () => {
    const user = userEvent.setup();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      const { container } = render(<DataSection sampleData={noSample} jobRetentionHours={24} hasApiKey={false} exportName="x.json" backups={backups} />);
      const big = new File(["x"], "big.json", { type: "application/json" });
      Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });
      await user.upload(container.querySelector("input[type=file]")!, big);
      expect(fetch).not.toHaveBeenCalled();
      expect(toast).toHaveBeenLastCalledWith(expect.stringMatching(/^That file is over 10 MB/));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Nightly backups (E10-7)", () => {
  it("says where backups are kept and when the last one ran", () => {
    render(<DataSection sampleData={noSample} jobRetentionHours={24} hasApiKey={false} exportName="x.json" backups={backups} />);
    const toggle = screen.getByRole("switch", { name: "Nightly backups" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAccessibleDescription("Kept for 14 days in /data/backups. Last one ran today at 03:00.");
  });

  it("says when the first one will run", () => {
    render(<DataSection sampleData={noSample} jobRetentionHours={24} hasApiKey={false} exportName="x.json" backups={{ ...backups, lastRun: null }} />);
    expect(screen.getByRole("switch", { name: "Nightly backups" })).toHaveAccessibleDescription("Kept for 14 days in /data/backups. The first one runs tonight at 03:00.");
  });

  it("shows a failure", () => {
    render(<DataSection sampleData={noSample} jobRetentionHours={24} hasApiKey={false} exportName="x.json" backups={{ ...backups, problem: "EACCES: permission denied" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The last backup failed: EACCES: permission denied");
  });

  it("switches them off", async () => {
    const user = userEvent.setup();
    render(<DataSection sampleData={noSample} jobRetentionHours={24} hasApiKey={false} exportName="x.json" backups={backups} />);
    await user.click(screen.getByRole("switch", { name: "Nightly backups" }));
    expect(updateSettings).toHaveBeenCalledWith({ nightlyBackup: false });
    expect(screen.getByRole("switch", { name: "Nightly backups" })).toHaveAccessibleDescription("Off. You'll only have what you export yourself.");
  });
});

describe("Keep task data for", () => {
  it("says what it keeps, and changes how long", async () => {
    const user = userEvent.setup();
    render(<DataSection sampleData={noSample} jobRetentionHours={24} hasApiKey={false} exportName="x.json" backups={backups} />);
    const select = screen.getByRole("combobox", { name: "Keep task data for" });
    expect(select).toHaveDisplayValue("24 hours");
    expect(screen.getByText(/your resume's text, drafts you didn't turn into an application/)).toBeInTheDocument();
    await user.selectOptions(select, "1 hour");
    expect(updateSettings).toHaveBeenCalledWith({ jobRetentionHours: 1 });
    expect(select).toHaveDisplayValue("1 hour");
  });

  it("goes back when the change isn't saved", async () => {
    const user = userEvent.setup();
    vi.mocked(updateSettings).mockResolvedValueOnce({ ok: false, error: "You seem to be offline." });
    render(<DataSection sampleData={noSample} jobRetentionHours={24} hasApiKey={false} exportName="x.json" backups={backups} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Keep task data for" }), "7 days");
    expect(toast).toHaveBeenCalledWith("You seem to be offline.");
    expect(screen.getByRole("combobox", { name: "Keep task data for" })).toHaveDisplayValue("24 hours");
  });
});

describe("Delete everything (E10-8)", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    render(<DataSection sampleData={noSample} jobRetentionHours={24} hasApiKey={false} exportName="x.json" backups={backups} />);
    const zone = screen.getByRole("region", { name: "Delete everything" });
    expect(zone).toHaveTextContent(/and the backups from this server\. This can't be undone, so export first/);
    await user.click(screen.getByRole("button", { name: "Delete everything…" }));
    return screen.getByRole("textbox", { name: "Type DELETE to confirm" });
  };

  it("asks for DELETE, exactly", async () => {
    const user = userEvent.setup();
    const box = await open(user);
    expect(box).toHaveFocus();
    await user.type(box, "delete");
    expect(screen.getByRole("button", { name: "Delete for good" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("button", { name: "Delete for good" }));
    expect(toast).toHaveBeenLastCalledWith("Type DELETE in capitals to confirm.");
    expect(deleteEverything).not.toHaveBeenCalled();
  });

  it("deletes once DELETE is typed", async () => {
    const user = userEvent.setup();
    const box = await open(user);
    await user.type(box, "DELETE");
    expect(screen.getByRole("button", { name: "Delete for good" })).not.toHaveAttribute("aria-disabled");
    await user.click(screen.getByRole("button", { name: "Delete for good" }));
    expect(deleteEverything).toHaveBeenCalledWith({ confirm: "DELETE" });
  });

  it("cancels", async () => {
    const user = userEvent.setup();
    await open(user);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox", { name: "Type DELETE to confirm" })).not.toBeInTheDocument();
  });
});

describe("sample data", () => {
  it("loads the sample job search with a click, then refreshes", async () => {
    const user = userEvent.setup();
    render(<DataSection sampleData={noSample} jobRetentionHours={24} hasApiKey={false} exportName="x.json" backups={backups} />);
    await user.click(screen.getByRole("button", { name: "Load sample data" }));
    expect(loadSample).toHaveBeenCalledWith({});
    expect(router.refresh).toHaveBeenCalled();
  });

  it("offers to remove it once it's in", async () => {
    const user = userEvent.setup();
    render(<DataSection sampleData={{ loaded: true, loadedAt: "2026-11-03T10:00:00.000Z", canLoad: false }} jobRetentionHours={24} hasApiKey={false} exportName="x.json" backups={backups} />);
    expect(screen.queryByRole("button", { name: "Load sample data" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove sample data" }));
    expect(removeSample).toHaveBeenCalledWith({});
  });

  it("can't be loaded over the user's own data", () => {
    render(<DataSection sampleData={{ loaded: false, loadedAt: null, canLoad: false }} jobRetentionHours={24} hasApiKey={false} exportName="x.json" backups={backups} />);
    expect(screen.getByRole("button", { name: "Load sample data" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("It needs an empty Scout, and this one already has a profile or applications.")).toBeInTheDocument();
  });
});
