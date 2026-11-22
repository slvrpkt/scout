import { execFileSync } from "node:child_process";

import { testDatabaseUrl } from "./db";

/**
 * Creates the test database if needed and applies all migrations, once per
 * test run. Prisma's CLI is started through Node itself rather than `yarn`,
 * which Windows can't start this way (it's a .cmd there), so the database
 * tests run the same on Windows, macOS, Linux and in Docker.
 */
export default function setup() {
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "prisma7.config.ts"], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: "pipe",
  });
}
