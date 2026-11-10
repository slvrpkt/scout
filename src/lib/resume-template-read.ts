import "server-only";

import { RESUME_MAX_BYTES } from "@/lib/resume-text";
import type { LayoutLine, ResumeLayout } from "@/lib/resume-template";

// Reads where things are on a resume file's first page, for its template: on
// this computer, with no AI. PDF gives positions; Word gives its page setup.

const starts = (bytes: Uint8Array, signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];
const ZIP = [0x50, 0x4b, 0x03, 0x04];

type PdfItem = { str: string; transform: number[]; width: number };

async function pdfLayout(bytes: Uint8Array): Promise<ResumeLayout> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const page = await pdf.getPage(1);
  const { width, height } = page.getViewport({ scale: 1 });
  const items = (await page.getTextContent()).items.filter((item): item is typeof item & PdfItem => "str" in item && item.str.trim() !== "");
  const placed = items
    .map((item) => ({ text: item.str, x: item.transform[4], top: height - item.transform[5], size: Math.hypot(item.transform[2], item.transform[3]), right: item.transform[4] + item.width }))
    .toSorted((a, b) => a.top - b.top || a.x - b.x);
  if (placed.length === 0) return { marginX: 0, marginY: 0, lines: [] };
  const rows: (typeof placed)[] = [];
  for (const item of placed) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0].top - item.top) < 3) row.push(item);
    else rows.push([item]);
  }
  const lines: LayoutLine[] = rows.map((row) => ({
    text: row
      .toSorted((a, b) => a.x - b.x)
      .map((item) => item.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
    size: Math.max(...row.map((item) => item.size)),
  }));
  const left = Math.min(...placed.map((item) => item.x));
  const right = width - Math.max(...placed.map((item) => item.right));
  return { marginX: Math.min(left, right > 0 ? right : left) / 72, marginY: (placed[0].top - placed[0].size) / 72, lines };
}

const attribute = (xml: string, tag: string, name: string) => Number(new RegExp(`<w:${tag}\\b[^>]*\\bw:${name}="(\\d+)"`).exec(xml)?.[1] ?? NaN);
const decode = (text: string) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

async function wordLayout(bytes: Uint8Array): Promise<ResumeLayout> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  const styleXml = (await zip.file("word/styles.xml")?.async("string")) ?? "";
  const styleSizes = new Map<string, number>();
  for (const [, id, body] of styleXml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const size = /<w:sz w:val="(\d+)"/.exec(body)?.[1];
    if (size) styleSizes.set(id, Number(size) / 2);
  }
  const fallback = Number(/<w:docDefaults>[\s\S]*?<w:sz w:val="(\d+)"/.exec(styleXml)?.[1] ?? 22) / 2;
  const lines: LayoutLine[] = [];
  for (const [paragraph] of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const text = decode([...paragraph.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>/g)].map((match) => match[1] ?? "   ").join("")).trim();
    if (!text) continue;
    const runs = [...paragraph.matchAll(/<w:sz w:val="(\d+)"/g)].map((match) => Number(match[1]) / 2);
    const style = /<w:pStyle w:val="([^"]+)"/.exec(paragraph)?.[1];
    const bullet = paragraph.includes("<w:numPr>");
    lines.push({ text: bullet ? `• ${text}` : text, size: runs.length > 0 ? Math.max(...runs) : ((style ? styleSizes.get(style) : undefined) ?? fallback) });
  }
  const left = attribute(xml, "pgMar", "left");
  const right = attribute(xml, "pgMar", "right");
  const top = attribute(xml, "pgMar", "top");
  return { marginX: (Number.isNaN(right) ? left : Math.min(left, right)) / 1440, marginY: top / 1440, lines };
}

/** A resume file's layout, or why it can't be read. */
export async function resumeLayout(bytes: Uint8Array): Promise<ResumeLayout | { error: string }> {
  if (bytes.length > RESUME_MAX_BYTES) return { error: "That file is over 5 MB." };
  try {
    if (starts(bytes, PDF)) return await pdfLayout(bytes);
    if (starts(bytes, ZIP)) return await wordLayout(bytes);
  } catch {
    return { error: "That file couldn't be read. Try exporting it again as PDF or .docx." };
  }
  return { error: "Choose a PDF or a Word (.docx) file." };
}
