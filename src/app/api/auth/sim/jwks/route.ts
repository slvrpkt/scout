import { NextResponse } from "next/server";

import { authMode } from "@/lib/auth/oidc";
import { jwks } from "@/lib/auth/simulated-provider";

/** The simulated provider's public signing key (DOSSIER_AUTH=simulated); 404 otherwise. */
export async function GET(): Promise<Response> {
  if (authMode() !== "simulated") return new NextResponse(null, { status: 404 });
  return NextResponse.json(await jwks());
}
