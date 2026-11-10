"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "@/lib/env";

import { authMode, signOutUrl } from "./oidc";
import { endSession } from "./session";

/** Signs out from the sidebar (PRD AUTH-7); with Cognito, from its session too when its domain is set. */
export async function signOut(): Promise<void> {
  await endSession();
  if (authMode() === "cognito" && env.DOSSIER_COGNITO_DOMAIN) redirect(signOutUrl(await requestOrigin()) ?? "/login");
  redirect("/login");
}

/** The address the browser used, for Cognito to send it back to: DOSSIER_PUBLIC_URL, else the forwarded host. */
async function requestOrigin(): Promise<string> {
  if (env.DOSSIER_PUBLIC_URL) return env.DOSSIER_PUBLIC_URL;
  const request = await headers();
  const host = request.get("x-forwarded-host")?.split(",")[0]?.trim() || request.get("host");
  const protocol = request.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  return `${protocol}://${host}`;
}
