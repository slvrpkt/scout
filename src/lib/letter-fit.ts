import "server-only";

import { getAiProvider } from "@/lib/ai";
import { isAiConfigured } from "@/lib/ai/config";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { writeCoverLetter } from "@/lib/ai/tasks";
import { DocumentKind } from "@/generated/prisma/enums";
import { matchSchema, type Unit } from "@/lib/application-data";
import { loadDocuments, readJson } from "@/lib/application-documents";
import { updateDocuments } from "@/lib/document-units";
import { isParagraph } from "@/lib/letter-frame";
import { renderPdf } from "@/lib/pdf/render";

// A cover letter is one page, and not full to the brim: about three quarters
// of it on average. Past FULLEST it's written again, shorter.

export const AIM = 0.75;
export const FULLEST = 0.85;
const TRIES = 2;
/** Below this a shorter letter says too little. */
const FEWEST_WORDS = 120;

/** How many pages a printed letter has, and how much of its first page's text area it fills, 0 to 1. */
export async function letterFill(pdf: Uint8Array): Promise<{ pages: number; fill: number }> {
  const { getDocumentProxy } = await import("unpdf");
  const document = await getDocumentProxy(pdf.slice());
  const page = await document.getPage(1);
  const { height } = page.getViewport({ scale: 1 });
  const heights = (await page.getTextContent()).items.flatMap((item) => ("str" in item && item.str.trim() ? [item.transform[5] as number] : []));
  if (heights.length === 0) return { pages: document.numPages, fill: 0 };
  const top = Math.max(...heights);
  const bottom = Math.min(...heights);
  // The page's margins are even, and its text starts at the top one.
  return { pages: document.numPages, fill: (top - bottom) / (height - 2 * (height - top)) };
}

export const wordsIn = (units: readonly Pick<Unit, "id" | "text">[]) => units.filter(isParagraph).reduce((sum, unit) => sum + unit.text.split(/\s+/).filter(Boolean).length, 0);

/** How many words bring a letter of `words` to AIM, given how full it is now. */
export function wordsToAim(words: number, { pages, fill }: { pages: number; fill: number }): number {
  const now = pages > 1 ? pages - 1 + fill : fill;
  return Math.max(FEWEST_WORDS, Math.floor((words * AIM) / now));
}

export const fitsOnePage = ({ pages, fill }: { pages: number; fill: number }) => pages === 1 && fill <= FULLEST;

/** Writes the letter shorter until it fits; returns whether it does. Its frame and sign-off stay. */
export async function fitLetterToPage(applicationId: string, signal?: AbortSignal): Promise<boolean> {
  const path = `/print/letter/${applicationId}`;
  let measured = await letterFill(await renderPdf(path));
  if (fitsOnePage(measured)) return true;
  if (!(await isAiConfigured())) return false;
  const [provider, options] = await Promise.all([getAiProvider(), loadTaskOptions()]);
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const { application, profile, extracted, letter } = await loadDocuments(applicationId);
    if (!letter || !extracted) return false;
    const { data } = await writeCoverLetter(
      provider,
      {
        profile,
        extracted,
        match: readJson(matchSchema, application.match),
        tone: application.tone,
        facts: application.facts.map((fact) => fact.text),
        posting: application.postingText,
        maxWords: wordsToAim(wordsIn(letter.units), measured),
      },
      { ...options, signal },
    );
    await updateDocuments(applicationId, async (documents) => {
      const units = documents[DocumentKind.COVER_LETTER] ?? [];
      const first = units.findIndex(isParagraph);
      const others = units.filter((unit) => !isParagraph(unit));
      documents[DocumentKind.COVER_LETTER] = [...others.slice(0, first < 0 ? others.length : first), ...data.filter(isParagraph), ...others.slice(first < 0 ? others.length : first)];
    });
    measured = await letterFill(await renderPdf(path));
    if (fitsOnePage(measured)) return true;
  }
  return false;
}
