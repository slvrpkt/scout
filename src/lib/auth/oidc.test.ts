import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EnvError, parseEnv, type Env } from "@/lib/env";

import { finishSignIn, signOutUrl, startSignIn } from "./oidc";
import { configuration, exchange, issueCode, jwks } from "./simulated-provider";

// The whole sign-in, against the simulated provider: the same code runs
// against Cognito, whose endpoints come from the same discovery document.

const environment = vi.hoisted(() => ({ current: {} as Partial<Env> }));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  env: new Proxy({}, { get: (_, key) => environment.current[key as keyof Env] }),
}));

const origin = "http://localhost:3000";
const issuer = `${origin}/api/auth/sim`;

beforeEach(() => {
  environment.current = { DOSSIER_SECRET: "s".repeat(32), DOSSIER_AUTH: "simulated", DOSSIER_ALLOWED_EMAILS: ["me@example.com"] };
  // Scout's server calling the provider: answered by the simulated one directly.
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/.well-known/openid-configuration")) return Response.json(configuration(issuer));
    if (url.endsWith("/jwks")) return Response.json(await jwks());
    if (url.endsWith("/token")) {
      const tokens = await exchange(issuer, new URLSearchParams(String(init?.body)));
      return tokens ? Response.json(tokens) : Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    return new Response(null, { status: 404 });
  });
});
afterEach(() => vi.unstubAllGlobals());

/** Starts a sign-in and signs in on the provider's page as `email`; what the callback gets. */
async function signInAs(email: string, { tamper }: { tamper?: "state" | "verifier" } = {}) {
  const { url, cookie } = await startSignIn(origin, { next: "/applications", remember: true });
  const request = new URL(url).searchParams;
  const code = await issueCode({
    email,
    nonce: request.get("nonce")!,
    redirectUri: request.get("redirect_uri")!,
    challenge: tamper === "verifier" ? "someone-else" : request.get("code_challenge")!,
  });
  return finishSignIn(origin, new URLSearchParams({ code, state: tamper === "state" ? "forged" : request.get("state")! }), cookie);
}

describe("signing in with Cognito (simulated)", () => {
  it("sends the browser to the provider with PKCE, state and nonce", async () => {
    const { url } = await startSignIn(origin, { next: "/", remember: false });
    const sent = new URL(url);
    expect(`${sent.origin}${sent.pathname}`).toBe(`${issuer}/authorize`);
    expect(Object.fromEntries(sent.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "dossier-local",
      redirect_uri: `${origin}/api/auth/callback`,
      scope: "openid email",
      code_challenge_method: "S256",
    });
    expect(sent.searchParams.get("state")).toBeTruthy();
    expect(sent.searchParams.get("nonce")).toBeTruthy();
  });

  it("signs in an allowed address and goes where it was asked to", async () => {
    expect(await signInAs("Me@Example.com")).toEqual({ ok: true, email: "me@example.com", next: "/applications", remember: true });
  });

  it("refuses an address that isn't allowed", async () => {
    expect(await signInAs("someone@example.com")).toEqual({ ok: false, reason: "not-allowed" });
  });

  it("refuses a forged state and a code meant for another verifier", async () => {
    expect(await signInAs("me@example.com", { tamper: "state" })).toEqual({ ok: false, reason: "expired" });
    expect(await signInAs("me@example.com", { tamper: "verifier" })).toEqual({ ok: false, reason: "failed" });
  });

  it("refuses a callback without the sign-in cookie", async () => {
    expect(await finishSignIn(origin, new URLSearchParams({ code: "x", state: "y" }), undefined)).toEqual({ ok: false, reason: "expired" });
  });

  it("signs out of Cognito too when its domain is set", () => {
    expect(signOutUrl(origin)).toBeNull();
    environment.current = { ...environment.current, DOSSIER_AUTH: "cognito", DOSSIER_COGNITO_CLIENT_ID: "abc", DOSSIER_COGNITO_DOMAIN: "https://dossier.auth.us-east-1.amazoncognito.com" };
    expect(signOutUrl(origin)).toBe("https://dossier.auth.us-east-1.amazoncognito.com/logout?client_id=abc&logout_uri=http%3A%2F%2Flocalhost%3A3000%2Flogin");
  });
});

describe("the sign-in settings", () => {
  const valid = {
    DOSSIER_PASSWORD: "argon2id:m=19456,t=2,p=1:CLZW5wQoCjh3Q9CHBp_JWw:Ak2xS7TYlYYrhemlgBkVxFmWXfcMq_rjd0mJGZcZFfA",
    DOSSIER_SECRET: "a".repeat(32),
    DATABASE_URL: "postgresql://postgres:postgres@db:5432/dossier",
  };
  const problems = (source: Record<string, string>) => {
    try {
      parseEnv({ ...valid, ...source });
      return [];
    } catch (error) {
      if (error instanceof EnvError) return error.problems;
      throw error;
    }
  };

  it("needs the user pool and who may sign in for cognito", () => {
    expect(problems({ DOSSIER_AUTH: "cognito" })).toEqual([
      "DOSSIER_AUTH is cognito, so set DOSSIER_COGNITO_ISSUER and DOSSIER_COGNITO_CLIENT_ID to your user pool's issuer and app client ID.",
      "DOSSIER_AUTH is cognito, so set DOSSIER_ALLOWED_EMAILS to the email address (or addresses) that may sign in.",
    ]);
    expect(
      parseEnv({
        ...valid,
        DOSSIER_AUTH: "Cognito",
        DOSSIER_COGNITO_ISSUER: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AbC123/",
        DOSSIER_COGNITO_CLIENT_ID: "abc",
        DOSSIER_ALLOWED_EMAILS: "Me@Example.com, you@example.com",
      }),
    ).toMatchObject({ DOSSIER_AUTH: "cognito", DOSSIER_COGNITO_ISSUER: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_AbC123", DOSSIER_ALLOWED_EMAILS: ["me@example.com", "you@example.com"] });
  });

  it("keeps the simulated provider off servers", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(problems({ DOSSIER_AUTH: "simulated", DOSSIER_ALLOWED_EMAILS: "me@example.com" })).toEqual([
      "DOSSIER_AUTH=simulated is for trying sign-in on your own computer, not for a server: use cognito or password.",
    ]);
    vi.unstubAllEnvs();
  });
});
