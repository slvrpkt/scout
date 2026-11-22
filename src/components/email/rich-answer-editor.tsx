"use client";

import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
} from "@tiptap/react";
import { FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  RemoveFormatting,
  Strikethrough,
  Underline,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import {
  ANSWER_FONTS,
  ANSWER_SIZES,
  answerDocFromText,
  type AnswerNode,
} from "@/lib/rich-answer";

import styles from "./rich-answer-editor.module.css";

/** The editor's text as it's checked and kept: paragraphs a blank line apart. */
const plainText = (editor: Editor) =>
  editor.getText({ blockSeparator: "\n\n" });

/**
 * The answer to an employer, with formatting: bold, italic, underline,
 * strikethrough, lists, links, a font and a size. `doc` is the saved
 * document, else `text` (an AI draft) is loaded as paragraphs. `version`
 * changes when a new draft replaces what's there. Every change gives the
 * plain text, for the […] check, and the document, for the email.
 */
export function RichAnswerEditor({
  doc,
  text,
  version,
  busy = false,
  label,
  onChange,
  onBlur,
}: {
  doc: AnswerNode | null;
  text: string;
  version: number;
  busy?: boolean;
  label: string;
  onChange: (text: string, doc: AnswerNode) => void;
  onBlur?: () => void;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
        link: {
          openOnClick: false,
          protocols: ["mailto"],
          defaultProtocol: "https",
        },
      }),
      TextStyle,
      FontFamily,
      FontSize,
    ],
    content: doc ?? answerDocFromText(text),
    editorProps: {
      attributes: {
        "aria-label": label,
        role: "textbox",
        "aria-multiline": "true",
        class: styles.content,
      },
    },
    onUpdate: ({ editor }) =>
      onChange(plainText(editor), editor.getJSON() as AnswerNode),
    onBlur: () => onBlur?.(),
  });

  // A new AI draft replaces what's in the editor.
  useEffect(() => {
    if (!editor || version === 0) return;
    editor.commands.setContent(answerDocFromText(text), { emitUpdate: false });
    onChange(plainText(editor), editor.getJSON() as AnswerNode);
    // Only a new draft, not each keystroke, resets it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, version]);

  useEffect(() => {
    editor?.setEditable(!busy);
  }, [editor, busy]);

  return (
    <div
      className={cn(
        "flex flex-col rounded-control border border-line-input bg-input focus-within:border-primary",
        busy && "opacity-50",
      )}
    >
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} className={styles.editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      bullets: editor.isActive("bulletList"),
      numbers: editor.isActive("orderedList"),
      link: editor.isActive("link"),
      font:
        (editor.getAttributes("textStyle").fontFamily as string | undefined) ??
        "",
      size:
        (editor.getAttributes("textStyle").fontSize as string | undefined) ??
        "",
    }),
  });
  const chain = () => editor.chain().focus();
  // The link's address, typed in a field under the toolbar.
  const [href, setHref] = useState<string | null>(null);
  const link = () => (state.link ? chain().unsetLink().run() : setHref(""));
  const addLink = () => {
    const address = href?.trim() ?? "";
    setHref(null);
    if (!address) return void chain().run();
    chain()
      .extendMarkRange("link")
      .setLink({
        href: /^(https?:\/\/|mailto:)/i.test(address)
          ? address
          : `https://${address}`,
      })
      .run();
  };
  const select =
    "h-7 rounded-[6px] border border-line-field bg-input px-1.5 text-meta text-ink";
  return (
    <div className="flex flex-col border-b border-line">
      <div
        role="toolbar"
        aria-label="Formatting"
        className="flex flex-wrap items-center gap-1 px-2 py-1.5"
      >
        <select
          aria-label="Font"
          className={cn(select, "w-[136px]")}
          value={state.font}
          onChange={(event) =>
            event.target.value
              ? chain().setFontFamily(event.target.value).run()
              : chain().unsetFontFamily().run()
          }
        >
          <option value="">Default font</option>
          {ANSWER_FONTS.map((font) => (
            <option key={font.label} value={font.value}>
              {font.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Size"
          className={cn(select, "w-[88px]")}
          value={state.size}
          onChange={(event) =>
            event.target.value
              ? chain().setFontSize(event.target.value).run()
              : chain().unsetFontSize().run()
          }
        >
          {ANSWER_SIZES.map((size) => (
            <option key={size.label} value={size.value}>
              {size.label}
            </option>
          ))}
        </select>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
        <Tool
          label="Bold"
          on={state.bold}
          onClick={() => chain().toggleBold().run()}
        >
          <Bold size={15} />
        </Tool>
        <Tool
          label="Italic"
          on={state.italic}
          onClick={() => chain().toggleItalic().run()}
        >
          <Italic size={15} />
        </Tool>
        <Tool
          label="Underline"
          on={state.underline}
          onClick={() => chain().toggleUnderline().run()}
        >
          <Underline size={15} />
        </Tool>
        <Tool
          label="Strikethrough"
          on={state.strike}
          onClick={() => chain().toggleStrike().run()}
        >
          <Strikethrough size={15} />
        </Tool>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
        <Tool
          label="Bulleted list"
          on={state.bullets}
          onClick={() => chain().toggleBulletList().run()}
        >
          <List size={15} />
        </Tool>
        <Tool
          label="Numbered list"
          on={state.numbers}
          onClick={() => chain().toggleOrderedList().run()}
        >
          <ListOrdered size={15} />
        </Tool>
        <Tool
          label={state.link ? "Remove link" : "Link"}
          on={state.link}
          onClick={link}
        >
          <Link2 size={15} />
        </Tool>
        <Tool
          label="Clear formatting"
          on={false}
          onClick={() => chain().unsetAllMarks().clearNodes().run()}
        >
          <RemoveFormatting size={15} />
        </Tool>
      </div>
      {href !== null && (
        <div className="flex items-center gap-2 px-2 pb-1.5">
          <input
            aria-label="Link address"
            autoFocus
            value={href}
            placeholder="https://… or someone@example.com"
            onChange={(event) => setHref(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addLink();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setHref(null);
              }
            }}
            className="h-7 min-w-0 flex-1 rounded-[6px] border border-line-field bg-input px-2 text-meta"
          />
          <button title="Turn the selected text into a link"
            type="button"
            onClick={addLink}
            className="h-7 rounded-[6px] px-2 text-meta font-medium text-primary-text hover:bg-hover"
          >
            Add link
          </button>
        </div>
      )}
    </div>
  );
}

function Tool({
  label,
  on,
  onClick,
  children,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      // Keeps the selection in the editor while the button is pressed.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "grid size-7 place-items-center rounded-[6px] text-muted hover:bg-hover hover:text-ink",
        on && "bg-selected text-ink",
      )}
    >
      {children}
    </button>
  );
}
