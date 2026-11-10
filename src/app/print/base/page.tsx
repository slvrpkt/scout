import type { Metadata } from "next";

import { ResumeDocument } from "@/components/documents/resume-document";
import { versionAt } from "@/lib/base-resume";
import { verifyPrintAccess } from "@/lib/pdf/print-access";
import { loadProfile } from "@/lib/profile-data";
import { runningHeader } from "@/lib/resume-content";
import { BASE_LENGTHS } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";
import { loadTheme } from "@/lib/theme-data";
import { BUILT_IN_THEMES, printCss, RESUME_POINTS } from "@/lib/themes";

export const metadata: Metadata = { title: "Base resume", robots: { index: false } };

/** The base resume on its own, at a length, for the PDF renderer (E5-5) to print. */
export default async function PrintBaseResumePage({ searchParams }: PageProps<"/print/base">) {
  await verifyPrintAccess("/print/base");
  const [profile, settings, params] = await Promise.all([loadProfile(), loadSettings(), searchParams]);
  const length = BASE_LENGTHS.find((entry) => entry === params.length) ?? settings.baseLength;
  // How many trims to make: /api/pdf searches for the fewest that fit; else the last it found.
  const fit = Number(params.fit);
  const taken = Number.isInteger(fit) && fit >= 0 ? fit : (settings.baseFit[length]?.taken ?? 0);
  // The skills line under each job goes only as the fit's last resort.
  const noRoleSkills = params.skills === undefined ? Boolean(settings.baseFit[length]?.noSkills) : params.skills === "off";
  // Irrelevant certifications and tools go after them, before the recent jobs are shortened.
  const lastResort = params.hide === undefined ? (settings.baseFit[length]?.hide ?? []) : params.hide === "on" ? (settings.baseIrrelevant?.hide ?? []) : [];
  // Two pages: Skills, Tools, Education and Certifications kept to about a third of page two.
  const hide = [...(length === "2" ? (settings.baseCompact?.hide ?? []) : []), ...lastResort];
  const theme = { ...((await loadTheme(settings.baseThemeId)) ?? BUILT_IN_THEMES[0]), textPoints: RESUME_POINTS, noRoleSkills, hide };

  return (
    <>
      <style>{printCss(theme, settings.paper)}</style>
      <meta name="running-header" content={runningHeader(profile.basics).join("\n")} />
      <ResumeDocument
        theme={theme}
        profile={profile}
        paper={settings.paper}
        template={settings.resumeTemplate}
        includeReferences={settings.includeRefs}
        baseSummary={settings.baseSummary}
        language={settings.resumeLanguage}
        condense={versionAt(profile, length, settings.baseVersions, taken).condense}
        // Skills, and Tools & Platforms, at every length.
        skillsList
      />
    </>
  );
}
