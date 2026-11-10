import "server-only";

import { randomUUID } from "node:crypto";

import { EncryptJWT, exportJWK, generateKeyPair, jwtDecrypt, SignJWT, type CryptoKey, type JWK } from "jose";

import { env } from "@/lib/env";
import { deriveKey } from "@/lib/keys";

import { pkceChallenge, SIMULATED_CLIENT_ID } from "./oidc";

// A stand-in for an AWS Cognito user pool (DOSSIER_AUTH=simulated), served
// by Scout itself under /api/auth/sim, so sign-in works on this computer
// exactly as it will with Cognito: the same authorize → callback → token
// exchange → signed ID token. It has no users: anyone may type any address
// on its page, and Scout's check of DOSSIER_ALLOWED_EMAILS decides, as it
// will with the real pool. The env check refuses it in production.

const CODE_LIFETIME = "2m";

type Keys = { privateKey: CryptoKey; jwk: JWK };
// One signing key per run, kept across the dev server's hot reloads.
const globalForSim = globalThis as unknown as { simulatedKeys?: Promise<Keys> };

function keys(): Promise<Keys> {
  return (globalForSim.simulatedKeys ??= generateKeyPair("RS256", { extractable: true }).then(async ({ privateKey, publicKey }) => ({
    privateKey,
    jwk: { ...(await exportJWK(publicKey)), kid: randomUUID(), alg: "RS256", use: "sig" },
  })));
}

/** The OpenID configuration, as Cognito publishes one. */
export function configuration(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "email"],
    code_challenge_methods_supported: ["S256"],
  };
}

export async function jwks(): Promise<{ keys: JWK[] }> {
  return { keys: [(await keys()).jwk] };
}

/** What a code stands for: who signed in, for which request. */
type CodeClaims = { email: string; nonce: string; redirectUri: string; challenge: string };

/** The authorization code for a sign-in on the page: the sign-in itself, encrypted, so nothing is stored. */
export function issueCode(claims: CodeClaims): Promise<string> {
  return new EncryptJWT(claims).setProtectedHeader({ alg: "dir", enc: "A256GCM" }).setIssuedAt().setExpirationTime(CODE_LIFETIME).encrypt(deriveKey("simulated-sign-in"));
}

/** The token endpoint: an ID token for a valid code, its redirect URI and PKCE verifier; null otherwise. */
export async function exchange(issuer: string, form: URLSearchParams): Promise<{ id_token: string; token_type: "Bearer"; expires_in: number } | null> {
  if (form.get("grant_type") !== "authorization_code" || form.get("client_id") !== SIMULATED_CLIENT_ID) return null;
  let claims: CodeClaims;
  try {
    claims = (await jwtDecrypt(form.get("code") ?? "", deriveKey("simulated-sign-in"), { keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] })).payload as unknown as CodeClaims;
  } catch {
    return null;
  }
  if (claims.redirectUri !== form.get("redirect_uri") || claims.challenge !== pkceChallenge(form.get("code_verifier") ?? "")) return null;

  const { privateKey, jwk } = await keys();
  const idToken = await new SignJWT({ email: claims.email, email_verified: true, nonce: claims.nonce, token_use: "id", "cognito:username": claims.email })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setIssuer(issuer)
    .setAudience(SIMULATED_CLIENT_ID)
    .setSubject(claims.email)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return { id_token: idToken, token_type: "Bearer", expires_in: 3600 };
}

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The provider's sign-in page, standing in for Cognito's: the address to sign in as, posted back to itself. */
export function signInPage(params: URLSearchParams, error?: string): string {
  const hidden = ["client_id", "redirect_uri", "state", "nonce", "code_challenge"]
    .map((name) => `<input type="hidden" name="${name}" value="${escape(params.get(name) ?? "")}">`)
    .join("");
  const email = env.DOSSIER_ALLOWED_EMAILS?.[0] ?? "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Simulated Cognito</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #eef2f7; color: #0f172a; font: 15px/1.5 system-ui, sans-serif; }
  main { width: min(380px, calc(100vw - 32px)); background: #fff; border: 1px solid #dbe2ec; border-radius: 12px; padding: 28px; box-sizing: border-box; }
  .tag { display: inline-block; background: #fff4d6; color: #7a4b00; border-radius: 999px; padding: 2px 10px; font-size: 12px; font-weight: 600; }
  h1 { font-size: 22px; margin: 12px 0 4px; } p { color: #475569; margin: 0 0 18px; font-size: 13.5px; }
  label { display: block; font-size: 13px; font-weight: 600; margin: 12px 0 6px; }
  input[type=email], input[type=password] { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #94a3b8; border-radius: 8px; font: inherit; }
  button { margin-top: 18px; width: 100%; padding: 11px; border: 0; border-radius: 8px; background: #162032; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  .error { color: #b42318; font-size: 13.5px; margin: 10px 0 0; }
</style></head>
<body><main>
  <span class="tag">Simulated Cognito · this computer only</span>
  <h1>Sign in</h1>
  <p>Stands in for your Cognito user pool's sign-in page. Any password works here; Scout still only lets in the addresses in DOSSIER_ALLOWED_EMAILS.</p>
  <form method="post">${hidden}
    <label for="email">Email</label><input id="email" name="email" type="email" required autofocus value="${escape(email)}">
    <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="off">
    ${error ? `<p class="error" role="alert">${escape(error)}</p>` : ""}
    <button type="submit">Sign in</button>
  </form>
</main></body></html>`;
}
