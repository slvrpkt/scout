import type { Metadata } from "next";

import { loadArchive } from "@/lib/archive-data";

import { ArchiveScreen } from "./archive-screen";

export const metadata: Metadata = { title: "Archive" };

/** Everything set aside, postings and applications, in one table. */
export default async function ArchivePage() {
  return <ArchiveScreen rows={await loadArchive()} />;
}
