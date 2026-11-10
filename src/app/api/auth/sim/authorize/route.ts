import { type NextRequest, NextResponse } from "next/server";

import { authMode, SIMULATED_CLIENT_ID } from "@/lib/auth/oidc";
import { issueCode, signInPage } from "@/lib/auth/simulated-provider";
import { publicOrigin } from "@/lib/google/origin";

const html = (body: string, status = 200) => new NextResponse(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

/** Only Scout's own callback, for its own client. */
function validRequest(params: URLSearchParams, origin: string): boolean {
  return params.get("client_id") === SIMULATED_CLIENT_ID && params.get("redirect_uri") === `${origin}/api/auth/callback` && Boolean(params.get("state") && params.get("code_challenge"));
}

/** The simulated provider's sign-in page (DOSSIER_AUTH=simulated); 404 otherwise. */
export async function GET(request: NextRequest): Promise<Response> {
  if (authMode() !== "simulated") return new NextResponse(null, { status: 404 });
  const params = request.nextUrl.searchParams;
  if (!validRequest(params, publicOrigin(request))) return html("<p>That sign-in request isn't from this Scout.</p>", 400);
  return html(signInPage(params));
}

/** The page's submit: back to Scout's callback with a code, as Cognito does. */
export async function POST(request: NextRequest): Promise<Response> {
  if (authMode() !== "simulated") return new NextResponse(null, { status: 404 });
  const form = new URLSearchParams(await request.text());
  const origin = publicOrigin(request);
  if (!validRequest(form, origin)) return html("<p>That sign-in request isn't from this Scout.</p>", 400);
  const email = form.get("email")?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return html(signInPage(form, "Enter an email address."), 400);

  const back = new URL(form.get("redirect_uri")!);
  back.searchParams.set("code", await issueCode({ email, nonce: form.get("nonce") ?? "", redirectUri: back.toString(), challenge: form.get("code_challenge")! }));
  back.searchParams.set("state", form.get("state")!);
  return NextResponse.redirect(back, 303);
}
