import { z } from "zod";

// An answer to an employer written in the Inbox's editor (Tiptap), as the
// editor's JSON: turned into the email's HTML and its plain-text copy here,
// in code, so only what the editor offers goes out: paragraphs, lists, line
// breaks, bold, italic, underline, strikethrough, web links, and the fonts
// and sizes below. Everything is escaped; anything else is dropped.

/** The fonts the editor offers: open-source ones Scout bundles, then the classic email fonts. Each falls back to a font every reader has. */
export const ANSWER_FONTS = [
  {
    label: "Inter",
    value: "Inter, Arial, sans-serif",
    variable: "--typeface-inter",
  },
  {
    label: "IBM Plex Sans",
    value: "'IBM Plex Sans', Arial, sans-serif",
    variable: "--typeface-plex-sans",
  },
  {
    label: "Work Sans",
    value: "'Work Sans', Arial, sans-serif",
    variable: "--typeface-work-sans",
  },
  { label: "Lora", value: "Lora, Georgia, serif", variable: "--typeface-lora" },
  {
    label: "Source Serif",
    value: "'Source Serif 4', Georgia, serif",
    variable: "--typeface-source-serif",
  },
  {
    label: "EB Garamond",
    value: "'EB Garamond', Georgia, serif",
    variable: "--typeface-eb-garamond",
  },
  { label: "Arial", value: "Arial, Helvetica, sans-serif", variable: null },
  { label: "Georgia", value: "Georgia, serif", variable: null },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif", variable: null },
  {
    label: "Times New Roman",
    value: "'Times New Roman', Times, serif",
    variable: null,
  },
] as const;

/** The sizes the editor offers; Normal is the email's own. */
export const ANSWER_SIZES = [
  { label: "Small", value: "13px" },
  { label: "Normal", value: "" },
  { label: "Large", value: "18px" },
  { label: "Larger", value: "22px" },
] as const;

/** The whole answer's own look, around what the editor wrote. */
const BASE_STYLE =
  "font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.55;";

type Mark = { type: string; attrs?: Record<string, unknown> };
export type AnswerNode = {
  type: string;
  text?: string;
  content?: AnswerNode[];
  marks?: Mark[];
  attrs?: Record<string, unknown>;
};

/** A document from the editor, checked for shape only: what's in it is checked as it's rendered. */
export const answerDocSchema: z.ZodType<AnswerNode> = z.lazy(() =>
  z.object({
    type: z.string().max(40),
    text: z.string().max(20_000).optional(),
    content: z.array(answerDocSchema).max(2_000).optional(),
    marks: z
      .array(
        z.object({
          type: z.string().max(40),
          attrs: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .max(20)
      .optional(),
    attrs: z.record(z.string(), z.unknown()).optional(),
  }),
);

const escape = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fonts = new Set<string>(ANSWER_FONTS.map((font) => font.value));
const sizes = new Set<string>(
  ANSWER_SIZES.map((size) => size.value).filter(Boolean),
);

/** A link the email may carry: web and mail links only. */
const safeHref = (href: unknown) =>
  typeof href === "string" && /^(https?:\/\/|mailto:)/i.test(href.trim())
    ? href.trim()
    : null;

function markup(text: string, marks: readonly Mark[] = []): string {
  let html = escape(text);
  for (const mark of marks) {
    if (mark.type === "bold") html = `<strong>${html}</strong>`;
    else if (mark.type === "italic") html = `<em>${html}</em>`;
    else if (mark.type === "underline") html = `<u>${html}</u>`;
    else if (mark.type === "strike") html = `<s>${html}</s>`;
    else if (mark.type === "link") {
      const href = safeHref(mark.attrs?.href);
      if (href) html = `<a href="${escape(href)}">${html}</a>`;
    } else if (mark.type === "textStyle") {
      const styles = [
        typeof mark.attrs?.fontFamily === "string" &&
        fonts.has(mark.attrs.fontFamily)
          ? `font-family: ${mark.attrs.fontFamily}`
          : "",
        typeof mark.attrs?.fontSize === "string" &&
        sizes.has(mark.attrs.fontSize)
          ? `font-size: ${mark.attrs.fontSize}`
          : "",
      ].filter(Boolean);
      if (styles.length > 0)
        html = `<span style="${escape(styles.join("; "))}">${html}</span>`;
    }
  }
  return html;
}

function html(node: AnswerNode): string {
  const inner = () => (node.content ?? []).map(html).join("");
  switch (node.type) {
    case "doc":
      return inner();
    case "paragraph":
      return `<p style="margin: 0 0 12px">${inner() || "<br>"}</p>`;
    case "text":
      return markup(node.text ?? "", node.marks);
    case "hardBreak":
      return "<br>";
    case "bulletList":
      return `<ul style="margin: 0 0 12px; padding-left: 24px">${inner()}</ul>`;
    case "orderedList":
      return `<ol style="margin: 0 0 12px; padding-left: 24px">${inner()}</ol>`;
    case "listItem":
      return `<li>${inner().replace(/<p style="margin: 0 0 12px">/g, '<p style="margin: 0">')}</li>`;
    default:
      return inner();
  }
}

function text(
  node: AnswerNode,
  list: { ordered: boolean; index: number } | null = null,
): string {
  const children = node.content ?? [];
  switch (node.type) {
    case "text":
      return node.text ?? "";
    case "hardBreak":
      return "\n";
    case "paragraph":
      return children.map((child) => text(child)).join("");
    case "bulletList":
    case "orderedList":
      return children
        .map((child, index) =>
          text(child, { ordered: node.type === "orderedList", index }),
        )
        .join("\n");
    case "listItem":
      return `${list?.ordered ? `${list.index + 1}.` : "-"} ${children.map((child) => text(child)).join("\n   ")}`;
    default:
      return children.map((child) => text(child)).join("\n\n");
  }
}

/** The answer as the email's HTML and its plain-text copy. */
export function renderAnswer(doc: AnswerNode): { html: string; text: string } {
  return {
    html: `<div style="${BASE_STYLE}">${html(doc)}</div>`,
    text: text(doc)
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };
}

/** Plain text (an AI draft) as the editor's document: a paragraph per block, line breaks kept. */
export function answerDocFromText(plain: string): AnswerNode {
  const blocks = plain.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return {
    type: "doc",
    content: blocks.map((block) => {
      const lines = block.split("\n");
      const content: AnswerNode[] = lines.flatMap((line, index) => [
        ...(index > 0 ? [{ type: "hardBreak" }] : []),
        ...(line ? [{ type: "text", text: line }] : []),
      ]);
      return { type: "paragraph", ...(content.length > 0 ? { content } : {}) };
    }),
  };
}
