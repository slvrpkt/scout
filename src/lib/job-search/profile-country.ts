import "server-only";

import { prisma } from "@/lib/prisma";

import { countryCodeFor, countryName } from "./countries";

/**
 * The country company searches cover: the one in Profile → Basics, else the
 * United States. `fromProfile` says which, so the screen can explain it.
 */
export async function profileCountry(): Promise<{ code: string; name: string; fromProfile: boolean }> {
  const row = await prisma.profileField.findUnique({ where: { key: "country" } });
  const code = countryCodeFor(row?.value ?? "");
  return code ? { code, name: countryName(code), fromProfile: true } : { code: "us", name: countryName("us"), fromProfile: false };
}
