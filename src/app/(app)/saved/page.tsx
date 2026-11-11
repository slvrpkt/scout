import type { Metadata } from "next";

import { listPostings } from "@/lib/postings";

import { SavedScreen } from "./saved-screen";

export const metadata: Metadata = { title: "Saved for later" };

/** Jobs put aside from Agentic and Manual job search, to come back to. */
export default async function SavedPage() {
  return <SavedScreen postings={await listPostings("saved")} today={new Date().toISOString()} />;
}
