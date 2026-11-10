import path from "node:path";

import { defineConfig } from "@playwright/test";

import { APP_PORT, STORAGE_STATE } from "./e2e/support";

// Scout's README screenshots (e2e/scout-readme.ts), against the demo stack
// that e2e/scout-readme-stack.ts starts (the build, its own _e2e database and
// the fake AI and job sources). With the stack running:
//
//   npx playwright test --config playwright.scout-readme.config.ts
//
// The screenshots land in docs/images/.
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results/scout-readme",
  reporter: [["list"]],
  retries: 0,
  workers: 1,
  timeout: 120_000,
  use: { baseURL: `http://localhost:${APP_PORT}`, viewport: { width: 1440, height: 900 } },
  projects: [
    { name: "setup", testMatch: /setup\.ts$/ },
    { name: "scout-readme", testMatch: /scout-readme\.ts$/, use: { storageState: path.resolve(STORAGE_STATE) }, dependencies: ["setup"] },
  ],
});
