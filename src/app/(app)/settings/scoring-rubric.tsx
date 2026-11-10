"use client";

import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useAutosave } from "@/hooks/use-autosave";
import { RUBRIC_FIT_ID, RUBRIC_FIT_LABEL, RUBRIC_MAX_ITEMS, RUBRIC_POINTS, type RubricItem } from "@/lib/scoring/rubric";

import { saveScoringRubric } from "./actions";

const newId = () => `c${Math.random().toString(36).slice(2, 10)}`;

/**
 * Your own scoring rubric (#42): criteria in your words, each worth points
 * in steps of 5, and if you like Scout's own score as one of them. Saved as
 * you type; a criterion without words isn't saved. Empty, scoring stays as
 * the cards below describe.
 */
export function ScoringRubric({ initial }: { initial: RubricItem[] }) {
  const track = useTrackSave();
  // Fit now has its own points in "How a job is scored".
  const [items, setItems] = useState(() => initial.filter((item) => item.id !== RUBRIC_FIT_ID));
  const { flush } = useAutosave(items, (value) => track(saveScoringRubric({ rubric: value.filter((item) => item.label.trim()).map((item) => ({ ...item, label: item.label.trim() })) })));
  const change = (id: string, patch: Partial<RubricItem>) => setItems((list) => list.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const remove = (id: string) => setItems((list) => list.filter((item) => item.id !== id));
  const add = (item: RubricItem) => setItems((list) => [...list, item]);
  const full = items.length >= RUBRIC_MAX_ITEMS;
  const total = items.filter((item) => item.label.trim()).reduce((sum, item) => sum + item.points, 0);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-medium">Your own criteria</h2>
        <p className="text-sm text-muted">
          Up to {RUBRIC_MAX_ITEMS} more things that matter to you, in your words, such as &ldquo;A company with a clear mission&rdquo;, each worth points
          in steps of 5. The AI judges each one in the same call: all its points when met, half when partly met or when the posting doesn&apos;t say,
          none when not. They add to the points above.
        </p>
        <p className="text-meta text-muted">
          {items.length === 0
            ? "None yet: jobs are scored by the settings above."
            : "New scores use this rubric; scores already given stay as they were until a posting is scored again."}
        </p>
      </div>

      {items.length > 0 && (
        <ul className="flex flex-col gap-3" onBlur={flush}>
          {items.map((item, index) => (
            <li key={item.id} className="flex flex-wrap items-end gap-3">
              {item.id === RUBRIC_FIT_ID ? (
                <div className="flex min-w-[240px] flex-1 flex-col gap-1">
                  <span className="text-sm font-medium">{RUBRIC_FIT_LABEL}</span>
                  <span className="text-meta text-muted">Scout&apos;s score out of 100, as a share of these points.</span>
                </div>
              ) : (
                <Input
                  className="min-w-[240px] flex-1"
                  label={`Criterion ${index + 1}`}
                  placeholder="Remote"
                  maxLength={120}
                  value={item.label}
                  autoFocus={item.label === "" && index === items.length - 1}
                  onChange={(event) => change(item.id, { label: event.target.value })}
                />
              )}
              <Select className="w-28" label="Points" value={item.points} onChange={(event) => change(item.id, { points: Number(event.target.value) })}>
                {RUBRIC_POINTS.map((points) => (
                  <option key={points} value={points}>
                    {points}
                  </option>
                ))}
              </Select>
              <Button variant="text" size="sm" onClick={() => remove(item.id)} aria-label={`Remove ${item.id === RUBRIC_FIT_ID ? RUBRIC_FIT_LABEL : item.label || `criterion ${index + 1}`}`}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" aria-disabled={full || undefined} onClick={() => !full && add({ id: newId(), label: "", points: 25 })}>
          Add a criterion
        </Button>
        {items.length > 0 && <span className="text-meta text-muted">{total} points in all</span>}
        {full && <span className="text-meta text-muted">That&apos;s the most: {RUBRIC_MAX_ITEMS}.</span>}
      </div>
    </Card>
  );
}
