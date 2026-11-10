"use client";

import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { saveGoogleSettings } from "@/lib/google/actions";

import { SettingsSectionIntro } from "./settings-screen";

/** Every time zone the browser knows, for the field's suggestions. */
const ZONES: readonly string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

/**
 * Settings → Time zone: the zone Scout works in, for the dashboard calendar,
 * interview times, the job agent's run times and the weekday sheet sync. Empty
 * follows the browser's. It saves when you leave the field.
 */
export function TimeZoneSection({ initial, browserTimeZone }: { initial: string | null; browserTimeZone: string | null }) {
  const track = useTrackSave();
  const [saved, setSaved] = useState(initial ?? "");
  const [zone, setZone] = useState(initial ?? "");
  const inUse = saved || browserTimeZone || "your server's";
  const save = async () => {
    const next = zone.trim();
    if (next === saved) return;
    if (toastResult(await track(saveGoogleSettings({ workTimeZone: next }))).ok) setSaved(next);
    else setZone(saved);
  };
  return (
    <>
      <SettingsSectionIntro title="Time zone">
        The time zone Scout works in: the dashboard calendar, interview times, the job agent&apos;s run times and the Friday sync to Google
        Sheets all follow it.
      </SettingsSectionIntro>
      <Card className="flex flex-col gap-4">
        <p role="status" className="text-control">
          Working in <span className="font-medium">{inUse}</span>
          {!saved && browserTimeZone && <span className="text-muted"> (your browser&apos;s)</span>}
        </p>
        <Input
          label="Time zone"
          placeholder={browserTimeZone ?? "America/New_York"}
          hint={browserTimeZone ? `Leave it empty to follow your browser's: ${browserTimeZone}` : "Leave it empty to follow your browser's"}
          value={zone}
          spellCheck={false}
          list="time-zones"
          onChange={(event) => setZone(event.target.value)}
          onBlur={() => void save()}
        />
        <datalist id="time-zones">
          {ZONES.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </Card>
    </>
  );
}
