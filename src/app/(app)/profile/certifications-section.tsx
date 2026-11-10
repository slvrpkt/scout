"use client";

import { useTrackSave } from "@/components/save-tracker";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useAutosave } from "@/hooks/use-autosave";
import type { CertificationItem, ProfileData } from "@/lib/profile";

import { createCertification, removeCertification, reorderCertifications, restoreCertification, saveCertification } from "./actions";
import { EntryList } from "./entry-list";
import type { UpdateProfile } from "./skills-section";

const optional = (label: string) => (
  <>
    {label} <span className="font-normal text-muted">(optional)</span>
  </>
);

/** The fields of an open certification, autosaved as you type. */
function CertificationForm({ entry, onChange, autoFocus }: { entry: CertificationItem; onChange: (entry: CertificationItem) => void; autoFocus: boolean }) {
  const track = useTrackSave();
  const { flush } = useAutosave(entry, (value) => track(saveCertification(value)));
  const set = (change: Partial<CertificationItem>) => onChange({ ...entry, ...change });
  return (
    <div className="grid grid-cols-2 gap-[18px]" onBlur={flush}>
      <Input className="col-span-2" label={optional("Name")} placeholder="Project Management Professional (PMP)" value={entry.name} autoFocus={autoFocus} onChange={(event) => set({ name: event.target.value })} />
      <Input className="col-span-2" label={optional("Issuing organization")} placeholder="Project Management Institute" value={entry.issuer} onChange={(event) => set({ issuer: event.target.value })} />
      <Input label={optional("Issue date")} type="month" value={entry.issuedOn} onChange={(event) => set({ issuedOn: event.target.value })} />
      <Input
        label={optional("Expiration date")}
        type="month"
        value={entry.noExpiry ? "" : entry.expiresOn}
        disabled={entry.noExpiry}
        onChange={(event) => set({ expiresOn: event.target.value })}
      />
      <Checkbox className="col-span-2" label="This certification doesn't expire" checked={entry.noExpiry} onChange={(event) => set({ noExpiry: event.target.checked, expiresOn: event.target.checked ? "" : entry.expiresOn })} />
      <Input label={optional("Credential ID")} value={entry.credentialId} onChange={(event) => set({ credentialId: event.target.value })} />
      <Input label={optional("Credential URL")} placeholder="https://…" value={entry.url} onChange={(event) => set({ url: event.target.value })} />
      <Checkbox
        className="col-span-2"
        label="Show on resumes"
        hint="Off keeps it in your profile, but leaves it off every resume and out of what the AI reads."
        checked={entry.onResumes}
        onChange={(event) => set({ onResumes: event.target.checked })}
      />
    </div>
  );
}

/** "Mar 2024" from "2024-03". */
const month = (value: string) => {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match ? new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)) : "";
};

/**
 * Certifications, as LinkedIn has them: name, issuing organization, issue and
 * expiration dates (or none), credential ID and URL, all optional, in your
 * own order. Resumes show them word for word; the AI never rewrites them.
 */
export function CertificationsSection({ profile, update }: { profile: ProfileData; update: UpdateProfile }) {
  return (
    <EntryList
      items={profile.certifications ?? []}
      setItems={(change) => update((current) => ({ ...current, certifications: change(current.certifications ?? []) }))}
      addLabel="Add a certification"
      ordering={{ mode: "manual", save: (ids) => reorderCertifications({ ids }) }}
      summary={(entry) => ({
        title: entry.name.trim() || "New certification",
        subtitle: [entry.issuer.trim(), entry.issuedOn && `Issued ${month(entry.issuedOn)}`, entry.noExpiry ? "No expiration" : entry.expiresOn && `Expires ${month(entry.expiresOn)}`]
          .filter(Boolean)
          .join(" · "),
        meta: entry.onResumes ? undefined : "Not on resumes",
      })}
      create={() => createCertification({})}
      remove={(entry) => removeCertification({ id: entry.id })}
      restore={(entry) => restoreCertification(entry)}
      renderForm={(entry, { onChange, autoFocus }) => <CertificationForm entry={entry} onChange={onChange} autoFocus={autoFocus} />}
    />
  );
}
