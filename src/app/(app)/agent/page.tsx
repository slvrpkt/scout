import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { loadAgentView } from "@/lib/agent/view";

import { AgentScreen } from "./agent-screen";

export const metadata: Metadata = { title: "Job agent" };

/** The job agent (E16-6): what it found and the drafts it prepared, waiting for a look. */
export default async function AgentPage({ searchParams }: PageProps<"/agent">) {
  const { show, select } = await searchParams;
  // Archived postings are in the Archive now.
  if (show === "archived") redirect("/archive");
  return <AgentScreen view={await loadAgentView()} initialSelected={typeof select === "string" ? select : null} />;
}
