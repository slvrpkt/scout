"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { DocumentPreview } from "@/components/documents/document-preview";
import { DownloadPdfButton } from "@/components/documents/download-pdf-button";
import { ResumeDocument } from "@/components/documents/resume-document";
import { PageHeader } from "@/components/page-header";
import { toast, toastResult } from "@/components/toast";
import { buttonClassName } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PaperSize } from "@/generated/prisma/enums";
import type { ProfileData } from "@/lib/profile";
import { runningHeader, type ResumeOptions } from "@/lib/resume-content";
import { saveFile } from "@/lib/save-file";
import { pagesInWords, type BaseLength } from "@/lib/settings";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { ResumeTemplate } from "@/lib/resume-template";
import { parseThemeFile, themeFile, themeFileName } from "@/lib/theme-file";
import { PAPER_SIZES, RESUME_POINTS, type ThemeData } from "@/lib/themes";

import {
  deleteTheme,
  duplicateTheme,
  importTheme,
  saveTheme,
  setBaseLength,
  setBaseTheme,
} from "./actions";
import { draftFrom, ThemeBuilder, type ThemeDraft } from "./theme-builder";
import { ThemePicker } from "./theme-picker";

export type ResumeWorkspaceProps = {
  profile: ProfileData;
  themes: ThemeData[];
  /** How many applications' documents use each theme, by id (E5-7). */
  usage: Record<string, number>;
  baseThemeId: string;
  paper: PaperSize;
  includeReferences: boolean;
  /** The base resume's two-page rule, as the last PDF fitted it. */
  condense?: ResumeOptions["condense"];
  /** What the two-page rule is doing, in words, or null when it's off. */
  fitNote?: string | null;
  /** The pages the chosen length fits to: 2 or 3, or null for Full. */
  maxPages: number | null;
  /** The length chosen: Full, two pages or three. */
  length?: BaseLength;
  /** What fitting the pages left out, in words. */
  dropped?: string[];
  /** Settings → "Base resume language", for its headings and dates; null for English. */
  language: string | null;
  /** The skills line under each job was left out to fit. */
  noRoleSkills?: boolean;
  /** Certifications and tools the fit left out as its last resort. */
  hide?: string[];
  baseSummary?: ResumeOptions["baseSummary"];
  /** The layout from a resume you uploaded, which base and tailored resumes follow. */
  template?: ResumeTemplate | null;
};

type Panel = "themes" | "customize";

/** What happens to unsent drafts when the template changes. */
const redoingNote = (drafts = 0) =>
  drafts > 0
    ? ` Rewriting ${drafts === 1 ? "1 unsent draft" : `${drafts} unsent drafts`} in the background.`
    : "";

/**
 * The Base resume screen: the preview on the left and the theme panel on the
 * right, which moves below the preview on narrow windows. Picking a theme
 * shows it right away and saves it in the background; while you customise
 * one, the preview shows the draft.
 */
/** What the two- and three-page downloads say while the resume is rewritten to fit; the full one needs no rewriting. */
const fitNotice = (length: BaseLength) =>
  length === "full"
    ? undefined
    : `Hang tight. I'm rewriting your resume to fit on ${length === "2" ? "two" : "three"} pages. It takes about 1 to 2 minutes, and the file downloads by itself when it's done.`;

export function ResumeWorkspace({
  profile,
  themes: initialThemes,
  usage,
  baseThemeId,
  paper,
  includeReferences,
  condense,
  fitNote = null,
  maxPages,
  length = "2",
  dropped = [],
  language,
  noRoleSkills = false,
  hide = [],
  baseSummary,
  template: savedTemplate = null,
}: ResumeWorkspaceProps) {
  const [themes, setThemes] = useState(initialThemes);
  const [template, setTemplate] = useState(savedTemplate);
  // The length shows at once, and the page reloads with its version.
  const [shownLength, setShownLength] = useState(length);
  const chooseLength = async (next: BaseLength) => {
    setShownLength(next);
    if (!toastResult(await setBaseLength({ length: next })).ok)
      setShownLength(length);
  };
  const [baseId, setBaseId] = useState(baseThemeId);
  const [panel, setPanel] = useState<Panel>("themes");
  const [draft, setDraft] = useState<ThemeDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ThemeData | null>(null);
  // The last base theme the server confirmed, to go back to if a save fails,
  // and the last one picked, so an older failure doesn't undo a newer pick.
  const savedId = useRef(baseThemeId);
  const pickedId = useRef(baseThemeId);

  const base = themes.find((entry) => entry.id === baseId) ?? themes[0];
  const theme: ThemeData = draft
    ? { ...draft, id: draft.id ?? "draft", builtIn: false }
    : base;
  const empty =
    !profile.basics.name.trim() &&
    profile.experience.length === 0 &&
    profile.projects.length === 0 &&
    profile.education.length === 0 &&
    profile.skills.length === 0;

  // E11-3: opening or leaving the builder replaces the panel's controls, so
  // focus follows: to the theme's name, or back to the theme in use.
  const panelArea = useRef<HTMLElement>(null);
  const movedPanel = useRef(false);
  useEffect(() => {
    if (!movedPanel.current) return;
    movedPanel.current = false;
    // A frame later: the tab's content mounts after this render.
    const frame = requestAnimationFrame(() =>
      panelArea.current
        ?.querySelector<HTMLElement>(
          panel === "customize" ? "input" : "[data-in-use]",
        )
        ?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [panel]);

  /** Switches panels; `moveFocus` when the control used goes away with the old panel. */
  const openPanel = (next: Panel, moveFocus = false) => {
    movedPanel.current = moveFocus;
    // Customize starts from the theme in use; leaving it discards the draft.
    setDraft(next === "customize" ? (draft ?? draftFrom(base)) : null);
    setPanel(next);
  };

  const selectTheme = async (id: string) => {
    if (id === baseId) return;
    setBaseId(id);
    pickedId.current = id;
    const result = toastResult(await setBaseTheme({ id }));
    if (result.ok) savedId.current = id;
    else if (pickedId.current === id) setBaseId(savedId.current);
  };

  /** A new custom theme, now the base theme: from a copy or an imported file. */
  const addTheme = (added: ThemeData) => {
    setThemes((current) => [...current, added]);
    setBaseId(added.id);
    savedId.current = pickedId.current = added.id;
  };

  // E5-7: what can be done with the theme in use.
  const duplicate = async () => {
    const result = toastResult(await duplicateTheme({ id: base.id }));
    if (result.ok) addTheme(result.data);
  };

  const exportFile = () =>
    saveFile(
      new Blob([JSON.stringify(themeFile(base), null, 2)], {
        type: "application/json",
      }),
      themeFileName(base),
    );

  const uploadTemplate = async (file: File) => {
    const response = await fetch(
      `/api/resume/template?name=${encodeURIComponent(file.name)}`,
      { method: "POST", body: file },
    ).catch(() => null);
    const answer = (await response?.json().catch(() => null)) as {
      template?: ResumeTemplate;
      redoing?: number;
      error?: string;
    } | null;
    if (!answer?.template)
      return toast(answer?.error ?? "That file couldn't be read. Try again.");
    setTemplate(answer.template);
    toast(
      `Your resumes now follow this template.${redoingNote(answer.redoing)}`,
    );
  };

  const removeTemplate = async () => {
    const response = await fetch("/api/resume/template", {
      method: "DELETE",
    }).catch(() => null);
    if (!response?.ok)
      return toast("The template couldn't be removed. Try again.");
    const answer = (await response.json().catch(() => null)) as {
      redoing?: number;
    } | null;
    setTemplate(null);
    toast(
      `Removed. Your resumes use the theme's own layout again.${redoingNote(answer?.redoing)}`,
    );
  };

  const importFile = async (file: File) => {
    if (!/\.json$/i.test(file.name)) return uploadTemplate(file);
    if (file.size > 100_000)
      return toast("That file is too big to be a Scout theme.");
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      return toast("That file isn't a Scout theme.");
    }
    // Checked here for a quick answer, and again on the server.
    const read = parseThemeFile(json);
    if (!read.ok) return toast(read.error);
    const result = toastResult(await importTheme({ file: json }));
    if (result.ok) addTheme(result.data);
  };

  const remove = async (theme: ThemeData) => {
    const result = toastResult(await deleteTheme({ id: theme.id }));
    if (!result.ok) return;
    setThemes((current) => current.filter((entry) => entry.id !== theme.id));
    setBaseId(result.data.baseThemeId);
    savedId.current = pickedId.current = result.data.baseThemeId;
    // Its Delete button is gone with it: focus goes to the theme in use now.
    requestAnimationFrame(() =>
      panelArea.current?.querySelector<HTMLElement>("[data-in-use]")?.focus(),
    );
  };

  const saveDraft = async () => {
    if (!draft) return;
    setSaving(true);
    const result = toastResult(await saveTheme(draft));
    setSaving(false);
    if (!result.ok) return;
    const saved = result.data;
    setThemes((current) =>
      current.some((entry) => entry.id === saved.id)
        ? current.map((entry) => (entry.id === saved.id ? saved : entry))
        : [...current, saved],
    );
    setBaseId(saved.id);
    savedId.current = pickedId.current = saved.id;
    openPanel("themes", true);
  };

  return (
    <>
      <PageHeader
        title="Base resume"
        description={
          <>
            Built straight from your profile. Every new application starts from
            this one, then gets tailored to the job.
            <span className="mt-1.5 block">
              <strong className="font-medium text-ink">
                Think of it as your knowledge base, not the resume you send.
              </strong>{" "}
              Scout tailors a resume to each job, at the number of pages you ask
              for, and picks from everything here. So put in every detail you
              might want to use: it&apos;s fine for this to run five, six or
              even ten pages. The two- and three-page versions here, and every
              tailored resume, are made from it.
            </span>
          </>
        }
        actions={
          <>
            <Link href="/profile" className={buttonClassName("secondary")}>
              Edit profile
            </Link>
            <SegmentedControl<BaseLength>
              aria-label="Length"
              size="sm"
              options={[
                { value: "full", label: "Full" },
                { value: "2", label: "Two pages" },
                { value: "3", label: "Three pages" },
              ]}
              value={shownLength}
              onValueChange={(next) => void chooseLength(next)}
            />
            <DownloadPdfButton
              variant="secondary"
              href={`/api/docx?doc=base&length=${shownLength}`}
              progress="Building your resume as a Word file and checking its pages in Word…"
              busyLabel="Building…"
              notice={fitNotice(shownLength)}
            >
              Download Word
            </DownloadPdfButton>
            <DownloadPdfButton
              href={`/api/pdf?doc=base&length=${shownLength}`}
              notice={fitNotice(shownLength)}
            >
              Download PDF
            </DownloadPdfButton>
          </>
        }
      />
      <div className="@container flex flex-1 flex-wrap border-t border-line">
        <DocumentPreview
          runningHeader={runningHeader(profile.basics)}
          label={theme.name}
          meta={(pages) =>
            `${PAPER_SIZES[paper].label} · ${pages} ${pages === 1 ? "page" : "pages"}`
          }
          notice={(pages) =>
            empty ? (
              // E11-4: an empty page needs a way forward.
              <p
                role="note"
                className="rounded-card bg-card px-4 py-2.5 text-meta text-muted"
              >
                Your resume fills in from your profile. Add your name and a role
                or two, and it takes shape here.{" "}
                <Link
                  href="/profile"
                  className="text-ink underline underline-offset-2"
                >
                  Go to your profile
                </Link>
              </p>
            ) : maxPages !== null && pages > maxPages ? (
              <p
                role="note"
                className="rounded-card bg-warning-surface px-4 py-2.5 text-meta text-warning"
              >
                The preview runs over {pagesInWords(maxPages)}. Downloading
                shortens it to fit, older jobs first and the most recent last,
                and counts the pages of the file you get; you&apos;re told if it
                still runs over.
              </p>
            ) : (
              (fitNote || dropped.length > 0) && (
                <div
                  role="status"
                  className="flex flex-col gap-1.5 rounded-card bg-card px-4 py-2.5 text-meta text-muted"
                >
                  {fitNote && <p>{fitNote}</p>}
                  {dropped.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-ink">
                        Shortened to fit{" "}
                        {maxPages ? pagesInWords(maxPages) : "the page"}:{" "}
                        {dropped.length === 1
                          ? "1 change"
                          : `${dropped.length} changes`}
                      </summary>
                      <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">
                        {dropped.map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )
            )
          }
        >
          <ResumeDocument
            theme={{ ...theme, textPoints: RESUME_POINTS, noRoleSkills, hide }}
            profile={profile}
            paper={paper}
            includeReferences={includeReferences}
            baseSummary={baseSummary}
            condense={condense}
            language={language}
            template={template}
            skillsList
          />
        </DocumentPreview>
        <aside
          ref={panelArea}
          aria-label="Theme"
          className="flex flex-[1_0_300px] flex-col border-t border-line bg-paper px-7 pt-7 pb-12 @min-[780px]:border-t-0 @min-[780px]:border-l"
        >
          <Tabs
            value={panel}
            onValueChange={(value) => openPanel(value as Panel)}
            className="flex flex-col gap-6"
          >
            <TabsList variant="segmented">
              <TabsTrigger value="themes">Themes</TabsTrigger>
              <TabsTrigger value="customize">Customize</TabsTrigger>
            </TabsList>
            <TabsContent value="themes">
              <ThemePicker
                themes={themes}
                activeId={theme.id}
                userName={profile.basics.name.trim() || "Your name"}
                onSelect={selectTheme}
                onCustomize={() => openPanel("customize", true)}
                actions={{
                  duplicate: () => void duplicate(),
                  exportFile,
                  remove: () => setDeleting(base),
                  importFile: (file) => void importFile(file),
                }}
                template={template}
                onRemoveTemplate={() => void removeTemplate()}
              />
            </TabsContent>
            <TabsContent value="customize">
              {draft && (
                <ThemeBuilder
                  draft={draft}
                  onChange={setDraft}
                  onSave={saveDraft}
                  onCancel={() => openPanel("themes", true)}
                  saving={saving}
                  template={template}
                />
              )}
            </TabsContent>
          </Tabs>
        </aside>
      </div>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete “${deleting?.name ?? ""}”?`}
        description={deleteDescription(
          deleting ? (usage[deleting.id] ?? 0) : 0,
        )}
        confirmLabel="Delete theme"
        onConfirm={() => deleting && void remove(deleting)}
      />
    </>
  );
}

/** What deleting the theme in use means (decided 29 September 2026: allowed while applications use it). */
function deleteDescription(applications: number): string {
  const used =
    applications === 0
      ? "No application uses it."
      : `${applications === 1 ? "One application uses" : `${applications} applications use`} it; their documents will use your base theme instead.`;
  return `${used} Editorial becomes your base theme. This can't be undone, but you can export the theme first.`;
}
