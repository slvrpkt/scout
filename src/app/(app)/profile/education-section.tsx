"use client";

import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { Textarea } from "@/components/ui/textarea";
import { useAutosave } from "@/hooks/use-autosave";
import type { EducationItem, EntryOrder, ProfileData } from "@/lib/profile";

import { createEducation, removeEducation, reorderEntries, restoreEducation, saveEducation, sortEntriesByDate } from "./actions";
import { EntryList } from "./entry-list";
import { useTrackSave } from "@/components/save-tracker";
import type { UpdateProfile } from "./skills-section";

function EducationForm({
  entry,
  onChange,
  autoFocus,
}: {
  entry: EducationItem;
  onChange: (entry: EducationItem) => void;
  autoFocus: boolean;
}) {
  const track = useTrackSave();
  const { flush } = useAutosave(entry, (value) => track(saveEducation(value)));
  const set = (change: Partial<EducationItem>) => onChange({ ...entry, ...change });

  return (
    <div className="grid grid-cols-2 gap-[18px]" onBlur={flush}>
      <Input
        className="col-span-2"
        label="Degree or course"
        placeholder="BSc Computer Science"
        value={entry.degree}
        onChange={(event) => set({ degree: event.target.value })}
        autoFocus={autoFocus}
      />
      <Input
        className="col-span-2"
        label="School"
        placeholder="Springfield University"
        value={entry.school}
        onChange={(event) => set({ school: event.target.value })}
      />
      <Input
        label="Graduation year"
        placeholder="2020"
        inputMode="numeric"
        maxLength={4}
        value={entry.endYear ? String(entry.endYear) : ""}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "").slice(0, 4);
          set({ endYear: digits ? Number(digits) : null, endMonth: null, current: false });
        }}
      />
      <Toggle
        className="self-end"
        label="Show year on resume"
        description="Off by default: the year stays here but isn't printed."
        checked={entry.showYear === true}
        onCheckedChange={(showYear) => set({ showYear })}
      />
      <Textarea
        className="col-span-2"
        label="Notes"
        placeholder="Thesis, honours, anything worth mentioning"
        rows={3}
        value={entry.notes}
        onChange={(event) => set({ notes: event.target.value })}
      />
    </div>
  );
}

/** Education (PRO-7): degrees, courses and certificates. */
export function EducationSection({ profile, update, order }: { profile: ProfileData; update: UpdateProfile; order: EntryOrder }) {
  return (
    <EntryList
      items={profile.education}
      setItems={(change) => update((current) => ({ ...current, education: change(current.education) }))}
      addLabel="Add education"
      ordering={{
        mode: order,
        save: (ids) => reorderEntries({ section: "education", ids }),
        sortByDate: () => sortEntriesByDate({ section: "education" }),
      }}
      summary={(entry) => ({
        title: entry.degree.trim() || "New entry",
        subtitle: entry.school.trim(),
        meta: entry.endYear ? `${entry.endYear}${entry.showYear === true ? "" : " (not on resumes)"}` : "",
      })}
      create={() => createEducation({})}
      remove={(entry) => removeEducation({ id: entry.id })}
      restore={(entry) => restoreEducation(entry)}
      renderForm={(entry, { onChange, autoFocus }) => (
        <EducationForm entry={entry} onChange={onChange} autoFocus={autoFocus} />
      )}
    />
  );
}
