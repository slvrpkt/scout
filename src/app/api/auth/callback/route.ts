import { type NextRequest, NextResponse } from "next/server";

import { finishSignIn, SIGN_IN_COOKIE } from "@/lib/auth/oidc";
import { startSession } from "@/lib/auth/session";
import { publicOrigin } from "@/lib/google/origin";
import { logServerError } from "@/lib/log";

/**
 * Where Cognito (or the simulated provider) sends the browser back after
 * sign-in. It comes from the provider's site, so route()'s same-origin check
 * can't apply: the state in the encrypted cookie proves Scout started it,
 * and the verified ID token says who it is. Then it's a normal session.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const origin = publicOrigin(request);
  let result;
  try {
    result = await finishSignIn(origin, request.nextUrl.searchParams, request.cookies.get(SIGN_IN_COOKIE)?.value);
  } catch (error) {
    logServerError("sign-in callback", error);
    result = { ok: false as const, reason: "failed" as const };
  }
  if (result.ok) await startSession({ persistent: result.remember });
  const response = NextResponse.redirect(new URL(result.ok ? result.next : `/login?error=${result.reason}`, origin));
  response.cookies.delete({ name: SIGN_IN_COOKIE, path: "/api/auth" });
  response.headers.set("cache-control", "private, no-store");
  return response;
}
