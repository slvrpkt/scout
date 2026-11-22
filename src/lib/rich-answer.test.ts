import { describe, expect, it } from "vitest";

import { answerDocFromText, renderAnswer } from "./rich-answer";

describe("an answer written in the Inbox's editor", () => {
  it("goes out as HTML with the formatting, and as plain text", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hi Anna, " },
            { type: "text", text: "Tuesday", marks: [{ type: "bold" }] },
            { type: "text", text: " works.", marks: [{ type: "textStyle", attrs: { fontFamily: "Lora, Georgia, serif", fontSize: "18px" } }] },
          ],
        },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Notice: 2 weeks" }] }] }] },
        { type: "paragraph", content: [{ type: "text", text: "My site", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }] },
      ],
    };
    const { html, text } = renderAnswer(doc);
    expect(html).toContain("<strong>Tuesday</strong>");
    expect(html).toContain('<span style="font-family: Lora, Georgia, serif; font-size: 18px"> works.</span>');
    expect(html).toContain("<ul");
    expect(html).toContain('<a href="https://example.com">My site</a>');
    expect(text).toBe("Hi Anna, Tuesday works.\n\n- Notice: 2 weeks\n\nMy site");
  });

  it("lets through only its own fonts and sizes, web links and escaped text", () => {
    const { html } = renderAnswer({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "<script>x</script>", marks: [{ type: "textStyle", attrs: { fontFamily: "x; background: url(evil)", fontSize: "99px" } }] },
            { type: "text", text: "click", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
          ],
        },
        { type: "image", attrs: { src: "https://evil.example/x.png" } },
      ],
    });
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).not.toMatch(/evil|javascript|99px|<script/);
    expect(html).not.toContain("<a ");
  });

  it("loads an AI draft as paragraphs, line breaks kept", () => {
    expect(answerDocFromText("Hi Anna,\n\nTuesday works.\nThanks")).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hi Anna," }] },
        { type: "paragraph", content: [{ type: "text", text: "Tuesday works." }, { type: "hardBreak" }, { type: "text", text: "Thanks" }] },
      ],
    });
  });
});
