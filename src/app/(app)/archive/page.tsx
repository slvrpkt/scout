import type { Metadata } from "next";

import { loadArchive } from "@/lib/archive-data";
import { loadSettings } from "@/lib/settings-data";

import { ArchiveScreen } from "./archive-screen";

export const metadata: Metadata = { title: "Archive" };

/** Everything set aside, postings and applications, in one table. */
export default async function ArchivePage() {
  const [rows, settings] = await Promise.all([loadArchive(), loadSettings()]);
  return <ArchiveScreen rows={rows} clearDays={settings.archiveClearDays} />;
}
