import type { Metadata } from "next";

import { isAiUsable } from "@/lib/ai/config";
import { BASE_LENGTH_PAGES, savedVersion, summarizingBaseResume, versionAt } from "@/lib/base-resume";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { loadThemes, loadThemeUsage } from "@/lib/theme-data";

import { ResumeWorkspace } from "./resume-workspace";

export const metadata: Metadata = { title: "Base resume" };

/** The base resume: a live preview of the profile in the chosen theme (RES-1). */
export default async function BaseResumePage() {
  const [profile, themes, settings, usage, aiReady, writing] = await Promise.all([loadProfile(), loadThemes(), loadSettings(), loadThemeUsage(), isAiUsable(), summarizingBaseResume()]);
  const length = settings.baseLength;
  const fit = settings.baseFit[length];
  const chosen = savedVersion(profile, length, settings.baseVersions) !== null;
  const title = profile.basics.headline.trim() || "your usual title";
  const fitNote = writing
    ? "Writing your Full, Two-page and Three-page versions from your profile…"
    : length === "full"
      ? chosen
        ? "Every point you wrote, polished. Nothing is left out."
        : "Every point you wrote, as you wrote it."
      : chosen
        ? `Your strongest points for ${title}, chosen from everything in your profile.`
        : aiReady
          ? "Each job's first points for now, until Scout chooses your strongest ones."
          : "Each job's first points. Add an AI model in Settings → AI provider so Scout can choose your strongest ones.";
  return (
    <ResumeWorkspace
      profile={profile}
      themes={themes}
      usage={usage}
      baseThemeId={settings.baseThemeId}
      paper={settings.paper}
      includeReferences={settings.includeRefs}
      condense={versionAt(profile, length, settings.baseVersions, fit?.taken ?? 0).condense}
      fitNote={fitNote}
      length={length}
      dropped={fit?.dropped ?? []}
      noRoleSkills={Boolean(fit?.noSkills)}
      hide={[...(length === "2" ? (settings.baseCompact?.hide ?? []) : []), ...(fit?.hide ?? [])]}
      language={settings.resumeLanguage}
      baseSummary={settings.baseSummary}
      maxPages={BASE_LENGTH_PAGES[length]}
      template={settings.resumeTemplate}
    />
  );
}
