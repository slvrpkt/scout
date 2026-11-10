// Starts what the README's screenshots need, without Playwright's webServer
// (its commands are POSIX shell): the fake AI, the fake job sources and the
// fake Google, then the standalone build on APP_PORT with the demo database
// (DATABASE_URL + "_e2e"). Run with tsx after `next build`, and stop with Ctrl+C.
import { spawn } from "node:child_process";

import { APP_PORT, appEnv, FAKE_AI_PORT, FAKE_GOOGLE_PORT, FAKE_JOBS_PORT } from "./support";

const start = (name: string, args: string[], env: Record<string, string>) => {
  const child = spawn(process.execPath, args, { env: { ...process.env, ...env }, stdio: ["ignore", "inherit", "inherit"] });
  child.on("exit", (code) => console.log(`${name} exited (${code})`));
  return child;
};

const children = [
  start("fake AI", ["e2e/fake-ai.mts"], { FAKE_AI_PORT: String(FAKE_AI_PORT) }),
  start("fake jobs", ["e2e/fake-jobs.mts"], { FAKE_JOBS_PORT: String(FAKE_JOBS_PORT) }),
  start("fake Google", ["e2e/fake-google.mts"], { FAKE_GOOGLE_PORT: String(FAKE_GOOGLE_PORT) }),
  start("app", [".next/standalone/server.js"], { ...appEnv(), HOSTNAME: "127.0.0.1", DOSSIER_DATA_DIR: process.env.SCOUT_DEMO_DATA_DIR ?? appEnv().DOSSIER_DATA_DIR }),
];
console.log(`Demo stack starting: the app on http://localhost:${APP_PORT}`);
process.on("SIGINT", () => {
  for (const child of children) child.kill();
  process.exit(0);
});
