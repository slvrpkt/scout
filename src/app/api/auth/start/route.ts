import { type NextRequest, NextResponse } from "next/server";

import { safeNextPath } from "@/lib/auth/next-path";
import { authMode, SIGN_IN_COOKIE, SIGN_IN_MAX_AGE, startSignIn } from "@/lib/auth/oidc";
import { publicOrigin } from "@/lib/google/origin";
import { logServerError } from "@/lib/log";

/**
 * "Sign in with Cognito" on the sign-in page: sends the browser to the user
 * pool's sign-in page (or the simulated one), with the state, nonce and PKCE
 * verifier in a short-lived encrypted cookie for the callback. It runs
 * signed out, so it can't go through route(); it only redirects.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const origin = publicOrigin(request);
  if (authMode() === "password") return NextResponse.redirect(new URL("/login", origin));
  const params = request.nextUrl.searchParams;
  try {
    const { url, cookie } = await startSignIn(origin, { next: safeNextPath(params.get("next") ?? undefined), remember: params.get("remember") === "on" });
    const response = NextResponse.redirect(url);
    response.cookies.set(SIGN_IN_COOKIE, cookie, { httpOnly: true, sameSite: "lax", path: "/api/auth", secure: origin.startsWith("https:"), maxAge: SIGN_IN_MAX_AGE });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    logServerError("sign-in start", error);
    return NextResponse.redirect(new URL("/login?error=unavailable", origin));
  }
}
