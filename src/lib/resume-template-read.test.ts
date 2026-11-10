import { Document, Packer, Paragraph, TextRun } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { templateFromLayout } from "./resume-template";
import { resumeLayout } from "./resume-template-read";

const LINES: [string, number][] = [
  ["Jane Doe", 14],
  ["Gettysburg, PA | jane@example.com | (717) 555-0100", 10],
  ["Summary", 11],
  ["Designer with years of experience.", 10],
  ["Experience", 11],
  ["Lead Designer", 11],
  ["Acme, Jan 2020 - Present", 9],
  ["Education", 11],
  ["BA, Design", 10],
];

describe("resumeLayout", () => {
  it("reads a PDF's margins and sizes", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage([612, 792]);
    let y = 792 - 36 - 14;
    for (const [text, size] of LINES) {
      page.drawText(text, { x: 43.2, y, size, font });
      y -= 18;
    }
    const layout = await resumeLayout(await pdf.save());
    if ("error" in layout) throw new Error(layout.error);
    expect(layout.lines.map((line) => line.text)).toEqual(LINES.map(([text]) => text));
    expect(templateFromLayout(layout, "mine.pdf")).toMatchObject({ marginX: 0.6, marginY: 0.5, nameSize: 14, contacts: ["location", "email", "phone"], order: ["summary", "experience", "education"], entry: "company-below" });
  });

  it("reads a Word file's page setup and sizes", async () => {
    const file = new Document({
      sections: [
        {
          properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
          children: LINES.map(([text, size]) => new Paragraph({ children: [new TextRun({ text, size: size * 2 })] })),
        },
      ],
    });
    const layout = await resumeLayout(new Uint8Array(await Packer.toBuffer(file)));
    if ("error" in layout) throw new Error(layout.error);
    expect(templateFromLayout(layout, "mine.docx")).toMatchObject({ marginX: 0.5, marginY: 0.5, nameSize: 14, order: ["summary", "experience", "education"] });
  });

  it("says when a file isn't a PDF or Word file", async () => {
    expect(await resumeLayout(new TextEncoder().encode("plain text"))).toEqual({ error: "Choose a PDF or a Word (.docx) file." });
  });
});
