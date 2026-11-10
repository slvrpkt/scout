import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TailoredLetter, TailoredResume } from "@/components/documents/tailored-documents";
import { DocumentKind } from "@/generated/prisma/enums";
import { loadDocuments, loadSentDocument } from "@/lib/application-documents";
import { verifyPrintAccess } from "@/lib/pdf/print-access";
import { runningHeader } from "@/lib/resume-content";
import { printCss } from "@/lib/themes";

export const metadata: Metadata = { title: "Tailored document", robots: { index: false } };

/**
 * An application's tailored resume (/print/resume/{id}) or cover letter
 * (/print/letter/{id}) on its own, for the PDF renderer (E8-8) to print;
 * /print/sent/{id} is a copy as it was sent (application history).
 */
export default async function PrintTailoredDocumentPage({ params }: PageProps<"/print/[doc]/[id]">) {
  const { doc, id } = await params;
  if (doc !== "resume" && doc !== "letter" && doc !== "sent") notFound();
  await verifyPrintAccess(`/print/${doc}/${id}`);
  const sent = doc === "sent" ? await loadSentDocument(id) : null;
  if (doc === "sent" && !sent) notFound();
  const { application, profile, settings, resume, letter, includeReferences, letterDate } = sent ?? (await loadDocuments(id));
  const isResume = sent ? sent.sent.kind === DocumentKind.RESUME : doc === "resume";
  const document = sent ? sent.document : isResume ? resume : letter;
  if (!document) notFound();

  return (
    <>
      <style>{printCss(document.theme, settings.paper)}</style>
      {isResume && <meta name="running-header" content={runningHeader(profile.basics).join("\n")} />}
      {isResume ? (
        <TailoredResume
          resume={document}
          profile={profile}
          paper={settings.paper}
          followThemeLayout={application.followThemeLayout}
          template={settings.resumeTemplate}
          language={application.language}
          includeReferences={includeReferences}
        />
      ) : (
        <TailoredLetter
          letter={document}
          profile={profile}
          paper={settings.paper}
          company={application.company}
          location={application.location}
          tone={application.tone}
          date={letterDate}
          dateFormat={settings.dateFormat}
          language={application.language}
        />
      )}
    </>
  );
}
