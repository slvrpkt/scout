import { type NextRequest, NextResponse } from "next/server";

import { authMode, SIMULATED_PATH } from "@/lib/auth/oidc";
import { exchange } from "@/lib/auth/simulated-provider";
import { publicOrigin } from "@/lib/google/origin";

/** The simulated provider's token endpoint (DOSSIER_AUTH=simulated): Scout's server calls it, not the browser. */
export async function POST(request: NextRequest): Promise<Response> {
  if (authMode() !== "simulated") return new NextResponse(null, { status: 404 });
  const tokens = await exchange(`${publicOrigin(request)}${SIMULATED_PATH}`, new URLSearchParams(await request.text()));
  return tokens ? NextResponse.json(tokens, { headers: { "cache-control": "no-store" } }) : NextResponse.json({ error: "invalid_grant" }, { status: 400 });
}
