"use client";

import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAutosave } from "@/hooks/use-autosave";
import { MILES_OPTIONS, PAY_FLOOR, scoringPrefsSchema, WORK_STYLE_NAMES, type ScoringPrefs } from "@/lib/scoring/preferences";

import { saveScoringPrefs } from "./actions";

const POINTS = Array.from({ length: 21 }, (_, index) => index * 5);
const SHARES = Array.from({ length: 21 }, (_, index) => index * 5);
const money = (value: number | null) => (value == null ? "" : value.toLocaleString("en-US"));
const moneyOf = (text: string) => {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
};
const wordsOf = (text: string) => [...new Set(text.split("\n").map((line) => line.trim()).filter(Boolean))].slice(0, 100);

/**
 * Your say in a job's score: how much the AI's fit counts, and points for
 * work style, pay and distance, which Scout works out itself at no cost.
 * Words that rule a job out, and hybrid or on-site jobs too far away, are set
 * aside before the AI is paid for. Saved as you type.
 */
export function ScoringPreferences({ initial, zipNote }: { initial: ScoringPrefs; zipNote: string | null }) {
  const track = useTrackSave();
  const [prefs, setPrefs] = useState(initial);
  const [payText, setPayText] = useState({ low: money(initial.pay.low), high: money(initial.pay.high) });
  const [wordsText, setWordsText] = useState(initial.ruleOut.join("\n"));
  const [note, setNote] = useState(zipNote);
  const valid = scoringPrefsSchema.safeParse(prefs);
  const { flush } = useAutosave(prefs, async (value) => {
    if (!scoringPrefsSchema.safeParse(value).success) return { ok: true as const, data: null };
    const result = await track(saveScoringPrefs({ prefs: value }));
    if (result.ok) setNote(result.data.zipNote);
    return result;
  });
  const set = (patch: Partial<ScoringPrefs>) => setPrefs((current) => ({ ...current, ...patch }));
  const total = prefs.fitPoints + prefs.work.points + prefs.pay.points + prefs.place.points;

  const pointsSelect = (label: string, value: number, change: (points: number) => void) => (
    <Select className="w-28" label={label} value={value} onChange={(event) => change(Number(event.target.value))}>
      {POINTS.map((points) => (
        <option key={points} value={points}>
          {points}
        </option>
      ))}
    </Select>
  );
  const shareSelect = (label: string, value: number, change: (share: number) => void) => (
    <Select className="w-32" label={label} value={value} onChange={(event) => change(Number(event.target.value))}>
      {SHARES.map((share) => (
        <option key={share} value={share}>
          {share}%
        </option>
      ))}
    </Select>
  );

  return (
    <Card className="flex flex-col gap-6" onBlur={flush}>
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-medium">How a job is scored</h2>
        <p className="text-sm text-muted">
          The AI judges only how well the job fits your skills and experience. Work style, pay and distance are scored by Scout from your settings here,
          for free and the same every time. The points below add up to the score out of 100. Jobs your settings rule out are set aside before anything
          is paid for.
        </p>
        <p className="text-meta text-muted">
          {total} points in all, plus your own criteria below. New scores use these settings; scores already given stay as they were.
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Fit with your profile (the AI)</h3>
        <div className="flex flex-wrap items-end gap-3">{pointsSelect("Points", prefs.fitPoints, (fitPoints) => set({ fitPoints }))}</div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Work style</h3>
        <p className="text-meta text-muted">The share of these points each work style gets. Read from the job board and the posting&apos;s own words.</p>
        <div className="flex flex-wrap items-end gap-3">
          {pointsSelect("Points", prefs.work.points, (points) => set({ work: { ...prefs.work, points } }))}
          {(["remote", "hybrid", "onsite", "unknown"] as const).map((style) => (
            <div key={style}>{shareSelect(WORK_STYLE_NAMES[style], prefs.work[style], (value) => set({ work: { ...prefs.work, [style]: value } }))}</div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Pay, a year</h3>
        <p className="text-meta text-muted">
          At or above your highest gets all the points; between the two, more the higher it goes. Below your lowest it gets fewer, the further below
          it is, but never less than {PAY_FLOOR}%: pay can be negotiated. Judged by the top of the posting&apos;s range.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          {pointsSelect("Points", prefs.pay.points, (points) => set({ pay: { ...prefs.pay, points } }))}
          <Input
            className="w-40"
            label="Lowest"
            inputMode="numeric"
            value={payText.low}
            onChange={(event) => {
              setPayText((text) => ({ ...text, low: event.target.value }));
              set({ pay: { ...prefs.pay, low: moneyOf(event.target.value) } });
            }}
          />
          <Input
            className="w-40"
            label="Highest"
            inputMode="numeric"
            value={payText.high}
            onChange={(event) => {
              setPayText((text) => ({ ...text, high: event.target.value }));
              set({ pay: { ...prefs.pay, high: moneyOf(event.target.value) } });
            }}
          />
          {shareSelect("Not listed", prefs.pay.unknown, (unknown) => set({ pay: { ...prefs.pay, unknown } }))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Distance, for hybrid and on-site jobs</h3>
        <p className="text-meta text-muted">
          Remote jobs get all these points. Closer gets more: all of them at your ZIP code, 60% at your limit, little past it.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          {pointsSelect("Points", prefs.place.points, (points) => set({ place: { ...prefs.place, points } }))}
          <Input
            className="w-32"
            label="Your ZIP code"
            inputMode="numeric"
            maxLength={5}
            value={prefs.place.zip}
            error={prefs.place.zip && !/^\d{5}$/.test(prefs.place.zip) ? "5 digits" : undefined}
            onChange={(event) => set({ place: { ...prefs.place, zip: event.target.value.replace(/[^\d]/g, "").slice(0, 5) } })}
          />
          <Select className="w-32" label="Up to" value={prefs.place.miles} onChange={(event) => set({ place: { ...prefs.place, miles: Number(event.target.value) } })}>
            {MILES_OPTIONS.map((miles) => (
              <option key={miles} value={miles}>
                {miles} miles
              </option>
            ))}
          </Select>
          {shareSelect("Unknown", prefs.place.unknown, (unknown) => set({ place: { ...prefs.place, unknown } }))}
        </div>
        <Checkbox
          label="Set aside hybrid and on-site jobs farther than that"
          hint="Before the AI, so they cost nothing. Off, they're scored with fewer points instead."
          checked={prefs.place.ruleOutFar}
          onChange={(event) => set({ place: { ...prefs.place, ruleOutFar: event.target.checked } })}
        />
        {note && <p className="text-meta text-warning">{note}</p>}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Freshly posted</h3>
        <p className="text-meta text-muted">
          Applying in the first hours gets more responses. A job posted within this window gets extra points, a label saying how new it is, and
          goes to the top of the Agentic job search list. With only the date known, it counts on the day it was posted.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Select className="w-36" label="Posted within" value={prefs.fresh.hours} onChange={(event) => set({ fresh: { ...prefs.fresh, hours: Number(event.target.value) } })}>
            {[0, 6, 12, 24, 48].map((hours) => (
              <option key={hours} value={hours}>
                {hours === 0 ? "Off" : `${hours} hours`}
              </option>
            ))}
          </Select>
          <Select className="w-28" label="Extra points" value={prefs.fresh.points} onChange={(event) => set({ fresh: { ...prefs.fresh, points: Number(event.target.value) } })}>
            {[0, 2, 3, 5, 8, 10, 15].map((points) => (
              <option key={points} value={points}>
                {points}
              </option>
            ))}
          </Select>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Words that rule a job out</h3>
        <Textarea
          label="One a line"
          hint="A job whose title or posting has one of these, as a whole word, is set aside before the AI and goes to Archived, saying which word. Case doesn't matter."
          rows={5}
          placeholder={"TS/SCI\nactive clearance\ncommission only"}
          value={wordsText}
          onChange={(event) => {
            setWordsText(event.target.value);
            set({ ruleOut: wordsOf(event.target.value) });
          }}
        />
      </section>
      {!valid.success && <p className="text-meta text-warning">Check the settings above; they&apos;re saved once they&apos;re complete.</p>}
    </Card>
  );
}
