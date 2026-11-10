import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { loadAgentPosting } from "@/lib/agent/view";
import { loadSettings } from "@/lib/settings-data";

import { AgentPosting } from "./agent-posting";

export const metadata: Metadata = { title: "Job posting" };

/**
 * A posting the agent found, on its own page: its title clicked on Agentic
 * job search, to read the whole posting before deciding. Nothing is written
 * until Prepare draft; one with a draft opens as its application.
 */
export default async function AgentPostingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [loaded, settings] = await Promise.all([loadAgentPosting(id), loadSettings()]);
  if (!loaded) notFound();
  if (loaded.drafted && loaded.posting.applicationId) redirect(`/applications/${loaded.posting.applicationId}`);
  return <AgentPosting posting={loaded.posting} archived={loaded.archived} minScore={settings.agentMinScore} />;
}
