"use client";

import { Dialog } from "radix-ui";
import { useRef, useState, type FormEvent, type MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import { RemovableChip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { MAX_ALT_TITLES, MAX_SEARCH_PLACES } from "@/lib/job-search/search";
import { MAX_SKIP_RULE_LENGTH, MAX_SKIP_RULES } from "@/lib/scoring/rubric";

/**
 * A box of tags, each with its ×. Clicking the box adds one in a popup.
 * Changes save at once, through `onChange`.
 */
function TagBox({
  title,
  tags,
  onChange,
  max,
  maxLength,
  addLabel,
  emptyPrompt,
  morePrompt,
  fullNote,
  description,
  inputLabel,
  placeholder,
  note,
}: {
  title: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  max: number;
  maxLength: number;
  /** Names the popup and the button that opens it. */
  addLabel: string;
  emptyPrompt: string;
  morePrompt: string;
  fullNote: string;
  description: string;
  inputLabel: string;
  placeholder?: string;
  note?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const addButton = useRef<HTMLButtonElement>(null);
  const full = tags.length >= max;

  const close = () => {
    setOpen(false);
    setText("");
  };
  const add = (event: FormEvent) => {
    event.preventDefault();
    const tag = text.trim().replace(/\s+/g, " ");
    if (!tag) return;
    if (!tags.some((entry) => entry.toLowerCase() === tag.toLowerCase())) onChange([...tags, tag]);
    close();
  };
  /** Anywhere in the box but on a tag's ×. The button inside does the same from the keyboard. */
  const clickBox = (event: MouseEvent<HTMLDivElement>) => {
    if (!full && !(event.target as HTMLElement).closest("button")) setOpen(true);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-field font-medium">{title}</span>
      <div
        onClick={clickBox}
        className="flex min-h-[60px] cursor-text flex-wrap content-start items-center gap-2 rounded-card border border-line-field bg-input px-3 py-2.5 hover:border-line-strong"
      >
        {tags.map((tag) => (
          <RemovableChip key={tag} removeLabel={`Remove ${tag}`} onRemove={() => onChange(tags.filter((entry) => entry !== tag))}>
            {tag}
          </RemovableChip>
        ))}
        {!full && (
          <button ref={addButton} type="button" onClick={() => setOpen(true)} aria-label={addLabel} className="px-1 py-[7px] text-control text-muted hover:text-ink">
            {tags.length === 0 ? emptyPrompt : morePrompt}
          </button>
        )}
      </div>
      {full && <p className="text-meta text-muted">{fullNote}</p>}
      {note && <p className="text-meta text-muted">{note}</p>}
      <Dialog.Root open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              addButton.current?.focus();
            }}
            className="fixed top-1/2 left-1/2 z-50 flex w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-dialog border border-line-popover bg-card p-6 shadow-menu"
          >
            <Dialog.Title className="font-serif text-[22px] leading-tight">{addLabel}</Dialog.Title>
            <Dialog.Description className="text-sm text-muted">{description}</Dialog.Description>
            <form onSubmit={add} className="flex flex-col gap-4">
              <Input label={inputLabel} value={text} placeholder={placeholder} maxLength={maxLength} onChange={(event) => setText(event.target.value)} autoFocus />
              <div className="flex justify-end gap-2">
                <Dialog.Close asChild>
                  <Button variant="secondary" type="button">
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button type="submit">Add</Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

/** A search's "What to skip". */
/** The most title words to skip. */
export const MAX_TITLE_SKIPS = 200;

export function SkipRules({ rules, onChange }: { rules: string[]; onChange: (rules: string[]) => void }) {
  return (
    <TagBox
      title="What to skip"
      tags={rules}
      onChange={onChange}
      max={MAX_SKIP_RULES}
      maxLength={MAX_SKIP_RULE_LENGTH}
      addLabel="Add what to skip"
      emptyPrompt="Click to add something to skip"
      morePrompt="Click to add another"
      fullNote={`You've reached the maximum of ${MAX_SKIP_RULES}.`}
      description="Describe one kind of job you don't want to see, like “PMP certification is required” or “security clearance is required”."
      inputLabel="Skip jobs when"
      note="The AI checks each new posting while scoring it, and clear matches go straight to Archived. If it isn't clear, like when something is only preferred, the job stays."
    />
  );
}

/** A search's locations: leave it empty to search the whole country. */
/** Settings → Job agent: titles ruled out before anything is paid for. */
export function TitleSkips({ titles, onChange }: { titles: string[]; onChange: (titles: string[]) => void }) {
  return (
    <TagBox
      title="Job titles to skip"
      tags={titles}
      onChange={onChange}
      max={MAX_TITLE_SKIPS}
      maxLength={60}
      addLabel="Add a title word to skip"
      emptyPrompt="Click to add a word"
      morePrompt="Click to add another"
      fullNote={`You've reached the maximum of ${MAX_TITLE_SKIPS}.`}
      description="A job whose title holds one of these words, like “intern” or “nurse”, is left out before it's scored, so it costs nothing. Whole words only: “rn” doesn't skip “Learning”."
      inputLabel="Word or words in the title"
      placeholder="e.g. intern"
    />
  );
}

/** A job agent search's other titles: up to MAX_ALT_TITLES, each searched on its own like its own title. */
export function AltTitles({ titles, onChange }: { titles: string[]; onChange: (titles: string[]) => void }) {
  const [shown, setShown] = useState(titles.length > 0);
  if (!shown) {
    return (
      <div className="flex justify-end">
        <button type="button" onClick={() => setShown(true)} className="text-meta font-medium text-ink underline underline-offset-2">
          + Add alternative titles
        </button>
      </div>
    );
  }
  return (
    <TagBox
      title="Alternative titles"
      tags={titles}
      onChange={onChange}
      max={MAX_ALT_TITLES}
      maxLength={120}
      addLabel="Add an alternative title"
      emptyPrompt="Click to add another title, like “TPM”"
      morePrompt="Click to add another title"
      fullNote={`You've reached the maximum of ${MAX_ALT_TITLES} alternative titles.`}
      description="Another title for the same kind of job, like “TPM” or “AI Program Manager”."
      inputLabel="Alternative title"
      note="Each title is searched on its own at every location, so each one uses its own requests."
    />
  );
}

export function SearchPlaces({ places, onChange }: { places: string[]; onChange: (places: string[]) => void }) {
  return (
    <TagBox
      title="Where"
      tags={places}
      onChange={onChange}
      max={MAX_SEARCH_PLACES}
      maxLength={120}
      addLabel="Add a location"
      emptyPrompt="Click to add a city, state or metro area"
      morePrompt="Click to add a location"
      fullNote={`You've reached the maximum of ${MAX_SEARCH_PLACES} locations.`}
      description="Type a city, state or metro area, like “Gaithersburg, Maryland”, “California” or “Washington DC-Baltimore Area”."
      inputLabel="Location"
      note="Leave it empty, or add “Anywhere”, to search the whole country. Each location is searched on its own, so each one uses its own requests."
    />
  );
}
