import { type NextRequest, NextResponse } from "next/server";

import { authMode, SIMULATED_PATH } from "@/lib/auth/oidc";
import { configuration } from "@/lib/auth/simulated-provider";
import { publicOrigin } from "@/lib/google/origin";

/** The simulated provider's OpenID configuration (DOSSIER_AUTH=simulated); 404 otherwise. */
export async function GET(request: NextRequest): Promise<Response> {
  if (authMode() !== "simulated") return new NextResponse(null, { status: 404 });
  return NextResponse.json(configuration(`${publicOrigin(request)}${SIMULATED_PATH}`));
}
