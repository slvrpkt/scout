import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { createRemoteJWKSet, EncryptJWT, jwtDecrypt, jwtVerify, type JWTVerifyGetKey } from "jose";

import { env } from "@/lib/env";
import { deriveKey } from "@/lib/keys";

// Signing in with AWS Cognito (DOSSIER_AUTH=cognito): the user pool's
// sign-in page, then OpenID Connect's authorization code flow with PKCE. The
// browser comes back to /api/auth/callback with a code; the server swaps it
// for an ID token, checks the token's signature, issuer, audience and nonce,
// and lets in only the addresses in DOSSIER_ALLOWED_EMAILS. What follows is
// Scout's own session, as after a password.
//
// DOSSIER_AUTH=simulated runs the same code against a stand-in for Cognito
// that Scout serves at /api/auth/sim (see ./simulated-provider.ts), so
// sign-in can be tried on this computer without an AWS account.

export type AuthMode = "password" | "cognito" | "simulated";

/** How this server signs people in. */
export const authMode = (): AuthMode => env.DOSSIER_AUTH ?? "password";

/** Where the simulated provider lives, under the app's own address. */
export const SIMULATED_PATH = "/api/auth/sim";
/** The simulated provider's app client. */
export const SIMULATED_CLIENT_ID = "dossier-local";

/** The cookie that carries the sign-in's state, nonce and PKCE verifier between start and callback. */
export const SIGN_IN_COOKIE = "dossier_sign_in";
/** How long the provider's page may take: ten minutes. */
export const SIGN_IN_MAX_AGE = 10 * 60;

export type Provider = { issuer: string; clientId: string; clientSecret?: string };

/** The provider for this server's mode, or null with password sign-in. */
export function provider(origin: string): Provider | null {
  const mode = authMode();
  if (mode === "simulated") return { issuer: `${origin}${SIMULATED_PATH}`, clientId: SIMULATED_CLIENT_ID };
  if (mode === "cognito") return { issuer: env.DOSSIER_COGNITO_ISSUER!, clientId: env.DOSSIER_COGNITO_CLIENT_ID!, clientSecret: env.DOSSIER_COGNITO_CLIENT_SECRET };
  return null;
}

type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string };

// Kept on globalThis so the dev server's hot reloads don't fetch them again.
const globalForOidc = globalThis as unknown as { oidcDiscovery?: Map<string, Promise<Discovery>>; oidcKeys?: Map<string, JWTVerifyGetKey> };
const discoveries = (globalForOidc.oidcDiscovery ??= new Map());
const keySets = (globalForOidc.oidcKeys ??= new Map());

/** The provider's endpoints, from its OpenID configuration. */
export function discover(issuer: string): Promise<Discovery> {
  let found = discoveries.get(issuer);
  if (!found) {
    found = fetch(`${issuer}/.well-known/openid-configuration`, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(`The sign-in provider's configuration answered ${response.status}.`);
      return (await response.json()) as Discovery;
    });
    // A failure is tried again next time.
    found.catch(() => discoveries.delete(issuer));
    discoveries.set(issuer, found);
  }
  return found;
}

const base64url = (bytes: Buffer) => bytes.toString("base64url");
export const pkceChallenge = (verifier: string) => base64url(createHash("sha256").update(verifier).digest());

/** What the sign-in cookie holds. */
type SignInState = { state: string; nonce: string; verifier: string; next: string; remember: boolean };

/** The redirect to the provider's sign-in page, and the sign-in cookie's value to set with it. */
export async function startSignIn(origin: string, { next, remember }: { next: string; remember: boolean }): Promise<{ url: string; cookie: string }> {
  const config = provider(origin);
  if (!config) throw new Error("Password sign-in has no provider.");
  const { authorization_endpoint } = await discover(config.issuer);
  const state: SignInState = { state: base64url(randomBytes(16)), nonce: base64url(randomBytes(16)), verifier: base64url(randomBytes(32)), next, remember };

  const url = new URL(authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: `${origin}/api/auth/callback`,
    scope: "openid email",
    state: state.state,
    nonce: state.nonce,
    code_challenge: pkceChallenge(state.verifier),
    code_challenge_method: "S256",
  }).toString();

  const cookie = await new EncryptJWT(state)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${SIGN_IN_MAX_AGE}s`)
    .encrypt(deriveKey("sign-in-state"));
  return { url: url.toString(), cookie };
}

export type SignInResult =
  | { ok: true; email: string; next: string; remember: boolean }
  /** expired: the cookie is gone or doesn't match; denied: the provider said no; not-allowed: an address that isn't in the list. */
  | { ok: false; reason: "expired" | "denied" | "not-allowed" | "failed" };

/**
 * Finishes the sign-in from the provider's redirect: checks the state
 * against the cookie, swaps the code for tokens and verifies the ID token.
 */
export async function finishSignIn(origin: string, params: URLSearchParams, cookie: string | undefined): Promise<SignInResult> {
  const config = provider(origin);
  if (!config) return { ok: false, reason: "failed" };
  let saved: SignInState;
  try {
    saved = (await jwtDecrypt(cookie ?? "", deriveKey("sign-in-state"), { keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] })).payload as unknown as SignInState;
  } catch {
    return { ok: false, reason: "expired" };
  }
  if (!params.get("state") || params.get("state") !== saved.state) return { ok: false, reason: "expired" };
  if (params.get("error")) return { ok: false, reason: "denied" };
  const code = params.get("code");
  if (!code) return { ok: false, reason: "failed" };

  const discovery = await discover(config.issuer);
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (config.clientSecret) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString("base64")}`;
  const response = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers,
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${origin}/api/auth/callback`, client_id: config.clientId, code_verifier: saved.verifier }),
    cache: "no-store",
  });
  if (!response.ok) return { ok: false, reason: "failed" };
  const { id_token: idToken } = (await response.json()) as { id_token?: string };
  if (!idToken) return { ok: false, reason: "failed" };

  let keys = keySets.get(discovery.jwks_uri);
  if (!keys) keySets.set(discovery.jwks_uri, (keys = createRemoteJWKSet(new URL(discovery.jwks_uri))));
  let claims;
  try {
    claims = (await jwtVerify(idToken, keys, { issuer: config.issuer, audience: config.clientId })).payload;
  } catch {
    return { ok: false, reason: "failed" };
  }
  if (claims.nonce !== saved.nonce) return { ok: false, reason: "expired" };
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email || claims.email_verified === false || claims.email_verified === "false") return { ok: false, reason: "not-allowed" };
  if (!(env.DOSSIER_ALLOWED_EMAILS ?? []).includes(email)) return { ok: false, reason: "not-allowed" };
  return { ok: true, email, next: saved.next, remember: saved.remember };
}

/** Where signing out sends the browser: Cognito's logout when its domain is set, so its own session ends too. */
export function signOutUrl(origin: string): string | null {
  if (authMode() !== "cognito" || !env.DOSSIER_COGNITO_DOMAIN) return null;
  const url = new URL(`${env.DOSSIER_COGNITO_DOMAIN}/logout`);
  url.search = new URLSearchParams({ client_id: env.DOSSIER_COGNITO_CLIENT_ID!, logout_uri: `${origin}/login` }).toString();
  return url.toString();
}
