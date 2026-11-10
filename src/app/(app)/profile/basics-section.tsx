"use client";

import { useState } from "react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAutosave } from "@/hooks/use-autosave";
import { isOptionalBasic, MAX_SUMMARY_LENGTH, type Basics, type BasicsField } from "@/lib/profile";

import { saveBasics } from "./actions";
import { useTrackSave } from "@/components/save-tracker";

type FieldSpec = {
  field: Exclude<BasicsField, "summary">;
  label: string;
  /** How much of the row it takes: all of it, two thirds, half (the default) or a third. */
  span?: "col-span-6" | "col-span-4" | "col-span-2";
  hint?: string;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
};

// PRO-1, in the prototype's order and layout.
const FIELDS: FieldSpec[] = [
  { field: "name", label: "Full name", span: "col-span-6", placeholder: "John Doe", autoComplete: "name" },
  { field: "headline", label: "Job title", span: "col-span-6", hint: "The title of the job you're looking for.", placeholder: "Senior Product Designer" },
  { field: "email", label: "Email", type: "email", placeholder: "john.doe@example.com", autoComplete: "email" },
  { field: "phone", label: "Phone", type: "tel", placeholder: "+1 555 010 0000", autoComplete: "tel" },
  { field: "address", label: "Street address", span: "col-span-4", placeholder: "12 Main Street", autoComplete: "street-address" },
  { field: "city", label: "City", span: "col-span-2", placeholder: "Springfield", autoComplete: "address-level2" },
  { field: "state", label: "State", span: "col-span-2", placeholder: "Illinois", autoComplete: "address-level1" },
  { field: "zip", label: "ZIP code", span: "col-span-2", placeholder: "62704", autoComplete: "postal-code" },
  { field: "country", label: "Country", span: "col-span-2", placeholder: "United States", autoComplete: "country-name" },
  { field: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/in/johndoe" },
  { field: "website", label: "Portfolio / Personal Website", placeholder: "yourname.com", autoComplete: "url" },
];

// Gentle format hints: they never block saving.
const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const looksLikeWebAddress = (value: string) =>
  /^(https?:\/\/)?[^\s/.]+(\.[^\s/.]+)+(\/\S*)?$/i.test(value.trim());

function formatHint(field: BasicsField, value: string): string | undefined {
  if (!value.trim()) return undefined;
  if (field === "email" && !looksLikeEmail(value)) return "That doesn't look like an email address yet.";
  if ((field === "website" || field === "linkedin") && !looksLikeWebAddress(value)) {
    return "That doesn't look like a web address yet, e.g. johndoe.example.com.";
  }
  return undefined;
}

/** A field label that says the field is optional (#216). */
function Optional({ label }: { label: string }) {
  return (
    <>
      {label} <span className="font-normal text-muted">(optional)</span>
    </>
  );
}

/** The Basics section (PRO-1, PRO-2), autosaved as you type (PRO-10). */
export function BasicsSection({ basics, onChange }: { basics: Basics; onChange: (basics: Basics) => void }) {
  const track = useTrackSave();
  const { flush } = useAutosave(basics, (value) => track(saveBasics(value)));
  // Hints show once you've left a field, not while you're typing in it.
  const [visited, setVisited] = useState<Set<BasicsField>>(new Set());

  const set = (field: BasicsField, value: string) => onChange({ ...basics, [field]: value });
  const leave = (field: BasicsField) => {
    setVisited((fields) => new Set(fields).add(field));
    flush();
  };

  return (
    <Card className="grid grid-cols-6 gap-x-[18px] gap-y-5">
      {FIELDS.map(({ field, label, span, hint, placeholder, type, autoComplete }) => (
        <Input
          key={field}
          className={span ?? "col-span-3"}
          label={isOptionalBasic(field) ? <Optional label={label} /> : label}
          type={type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          value={basics[field]}
          onChange={(event) => set(field, event.target.value)}
          onBlur={() => leave(field)}
          hint={(visited.has(field) ? formatHint(field, basics[field]) : undefined) ?? hint}
        />
      ))}
      <div className="relative col-span-6">
        <Textarea
          label="A few lines about you"
          textareaClassName="pb-8"
          placeholder="What you do, what you're good at, what you're looking for."
          rows={4}
          maxLength={MAX_SUMMARY_LENGTH}
          value={basics.summary}
          onChange={(event) => set("summary", event.target.value)}
          onBlur={() => leave("summary")}
        />
        <p aria-live="polite" className="pointer-events-none absolute right-3 bottom-2 text-xs text-muted">
          {(MAX_SUMMARY_LENGTH - basics.summary.length).toLocaleString()} characters left
        </p>
      </div>
    </Card>
  );
}
