import "server-only";

import { prisma } from "@/lib/prisma";

/** One of the encouraging lines in the Quote table, at random; null if there are none. */
export async function randomQuote(): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ text: string }[]>`SELECT "text" FROM "Quote" ORDER BY random() LIMIT 1`;
  return rows[0]?.text ?? null;
}
