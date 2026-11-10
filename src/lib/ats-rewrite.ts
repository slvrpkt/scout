import "server-only";

import { unitsSchema } from "@/lib/application-data";
import { DocumentKind, VersionCause } from "@/generated/prisma/enums";
import { loadDocuments } from "@/lib/application-documents";
import { ATS_ATTEMPTS, ATS_GOAL, atsGrade, type AtsGrade } from "@/lib/ats-grade";
import { updateDocuments } from "@/lib/document-units";
import { fitResumeToPages, rewriteResume } from "@/lib/page-limit";
import { prisma } from "@/lib/prisma";
import { experienceMonths } from "@/lib/profile";
import { resumeContent } from "@/lib/resume-content";
import { maxPages } from "@/lib/settings";
import { hasSidebar, withoutSidebar } from "@/lib/themes";

/** An application's resume grade as it would print now, or null without one. */
export function gradeOf({ application, profile, resume, extracted, includeReferences, settings }: Pick<Awaited<ReturnType<typeof loadDocuments>>, "application" | "profile" | "resume" | "extracted" | "includeReferences" | "settings">): AtsGrade | null {
  if (!resume) return null;
  const template = settings.resumeTemplate;
  const content = resumeContent(profile, { units: resume.units, includeReferences, template });
  const layout = application.followThemeLayout ? resume.theme.layout : withoutSidebar(resume.theme.layout);
  return atsGrade({
    content,
    sidebar: !template && hasSidebar(layout),
    requirements: extracted?.requirements ?? [],
    extras: {
      title: extracted?.title ?? application.role,
      years: Math.floor(experienceMonths(profile, new Date()) / 12),
      phone: profile.basics.phone,
      city: profile.basics.city,
      linkedin: profile.basics.linkedin,
    },
  });
}

/**
 * Rewrite to Reach A: a single column if it isn't one, then up to
 * ATS_ATTEMPTS rewrites naming what's missing, each fitted to the page limit
 * and graded again. Stops at an A, or as soon as a rewrite doesn't raise the
 * grade, and keeps the best version it made. Only what the profile backs
 * goes in, so an A isn't guaranteed.
 */
export async function rewriteToGrade(applicationId: string): Promise<{ grade: AtsGrade | null; attempts: number; singleColumn: boolean }> {
  // A sidebar costs enough to keep it from an A. The switch is above the resume, to change back.
  const singleColumn = (await prisma.application.updateMany({ where: { id: applicationId, followThemeLayout: true }, data: { followThemeLayout: false } })).count > 0;
  const graded = async () => {
    const documents = await loadDocuments(applicationId);
    return { documents, grade: gradeOf(documents) };
  };
  let { documents, grade } = await graded();
  if (!grade) return { grade, attempts: 0, singleColumn };
  const limit = documents.application.resumePageLimit ?? maxPages(documents.settings.pageLimit);
  let best = { score: grade.score, units: documents.resume?.units ?? [] };
  let attempts = 0;
  while (grade && grade.score < ATS_GOAL && attempts < ATS_ATTEMPTS) {
    attempts += 1;
    await rewriteResume(applicationId, documents.profile, {
      maxPages: limit,
      detail: "the resume for a higher ATS grade",
      before: "As it was before the ATS rewrite",
      // What's missing, and where the top skills should go.
      focus: [...grade.missing, ...grade.placement.map((skill) => `${skill}, in the summary or the most recent role, where the profile backs it`)],
    });
    if (limit) await fitResumeToPages(applicationId, documents.profile, limit, undefined, undefined, "deny");
    const before = best.score;
    ({ documents, grade } = await graded());
    if (grade && grade.score > best.score) best = { score: grade.score, units: documents.resume?.units ?? [] };
    // A rewrite that didn't raise the grade means what's missing isn't in the profile: more tries would only cost.
    if (!grade || grade.score <= before) break;
  }
  if (grade && grade.score < best.score) {
    await updateDocuments(
      applicationId,
      async (units) => {
        units[DocumentKind.RESUME] = unitsSchema.parse(best.units);
      },
      { version: { cause: VersionCause.REGENERATED, detail: "the best ATS version" } },
    );
    ({ grade } = await graded());
  }
  return { grade, attempts, singleColumn };
}
