import { expect, test, type Page } from "@playwright/test";

import { sql } from "./support";

// Scout's README screenshots, from the demo data (Jane Doe is made up) with the
// fake AI and job sources: see playwright.scout-readme.config.ts.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, timezoneId: "Europe/Amsterdam", locale: "en-GB" });
test.describe.configure({ mode: "serial" });

const IMAGES = "docs/images";

async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${IMAGES}/${name}.png`, fullPage });
}

test.beforeAll(async () => {
  // One agent search, as a user would set it up: a title, two others, three places, skip rules.
  await sql(`DELETE FROM "AgentCandidate"`);
  await sql(`DELETE FROM "AgentSearch"`);
  const query = { keywords: "Product designer", place: "", country: "nl", radiusKm: 25, remoteOnly: false, postedWithin: "3days", workModes: ["hybrid", "remote"], levels: ["senior"], minSalary: 60000 };
  await sql(
    `INSERT INTO "AgentSearch" (id, name, query, enabled, position, "maxPages", "skipRules", places, "altTitles", "updatedAt") VALUES ('readme-search', 'Product designer', $1, true, 0, 1, $2, $3, $4, now())`,
    [JSON.stringify(query), "Intern\nContract-to-hire", "Amsterdam\nRotterdam\nUtrecht", "UX Designer\nProduct Design Lead"],
  );
  await sql(`INSERT INTO "Setting" (key, value, "updatedAt") VALUES ('agentEnabled', 'true', now()) ON CONFLICT (key) DO UPDATE SET value = 'true'`);
  // Jane lives in Rotterdam: her times are Amsterdam's, whatever the computer taking the pictures says.
  await sql(`INSERT INTO "Setting" (key, value, "updatedAt") VALUES ('browserTimeZone', 'Europe/Amsterdam', now()) ON CONFLICT (key) DO UPDATE SET value = 'Europe/Amsterdam'`);
  // What a run leaves on the Agent screen (made-up postings): scored against Jane's profile, with reasons and the breakdown.
  const line = (label: string, earned: number, points: number, verdict: string, note: string) => ({ label, earned, points, verdict, note });
  const postings = [
    { id: "c1", title: "Senior Product Designer, Payments", company: "Ledgerly", place: "Amsterdam, NL", remote: false, salary: "€75,000–€90,000", hours: 2, score: 92, reasons: ["Led a design system used by 40 engineers, as the posting asks.", "Six years of product design in fintech and logistics.", "Posted 2 hours ago: +5 for applying early."], flags: [] },
    { id: "c2", title: "Product Design Lead", company: "Kestrel Maps", place: "Rotterdam, NL", remote: true, salary: "€85,000–€100,000", hours: 20, score: 86, reasons: ["Leads designers and runs research, both in her recent roles.", "Prototyping in Figma matches the core of the role."], flags: [] },
    { id: "c3", title: "UX Designer, Logistics", company: "Northwind Logistics", place: "Utrecht, NL", remote: false, salary: "", hours: 30, score: 79, reasons: ["Freight and logistics experience from her current job.", "User research and usability testing are her strengths."], flags: ["Pay isn't listed."] },
    { id: "c4", title: "Senior UX Designer", company: "Fieldnote", place: "Amsterdam, NL", remote: true, salary: "€70,000–€82,000", hours: 40, score: 74, reasons: ["Design systems and accessibility work fit what they ask for."], flags: ["Asks for Dutch at a business level."] },
    { id: "c5", title: "Product Designer (Contract)", company: "Studio Brik", place: "Rotterdam, NL", remote: false, salary: "€55/hour", hours: 44, score: 61, reasons: ["A good fit on skills."], flags: ["A six-month contract.", "On-site five days a week."] },
  ];
  for (const [index, posting] of postings.entries()) {
    const breakdown = [
      line("How well it fits your profile", Math.round(posting.score * 0.6), 60, "score", `Scored ${posting.score} of 100`),
      line(`Work style: ${posting.remote ? "Remote" : "Hybrid"}`, posting.remote ? 20 : 14, 20, "yours", posting.remote ? "Remote gets all of these points" : "Hybrid gets 70% of these points"),
      line(posting.salary ? `Pay: ${posting.salary}` : "Pay: not listed", posting.salary ? 13 : 7.5, 15, "yours", "Compared with your range"),
      line("Distance: about 12 km", 5, 5, "yours", "Within your limit"),
    ];
    await sql(
      `INSERT INTO "AgentCandidate" (id, source, "externalId", title, company, place, remote, salary, "postedAt", url, via, description, complete, score, reasons, "redFlags", breakdown, status, "dedupeKey", "searchId", "createdAt", "updatedAt")
       VALUES ($1, 'JSEARCH', $1, $2, $3, $4, $5, $6, now() - ($7 || ' hours')::interval, $8, 'LinkedIn', $9, true, $10, $11, $12, $13, 'SCORED', $1, 'readme-search', now() - ($14 || ' minutes')::interval, now())`,
      [`readme-${posting.id}`, posting.title, posting.company, posting.place, posting.remote, posting.salary, String(posting.hours), `https://example.com/jobs/${posting.id}`, `${posting.company} is hiring a ${posting.title}.`, posting.score, JSON.stringify(posting.reasons), JSON.stringify(posting.flags), JSON.stringify(breakdown), String(index * 3)],
    );
  }
});

test("the agentic job search: found, scored and ranked", async ({ page }) => {
  await page.goto("/agent");
  await expect(page.getByRole("heading", { level: 3, name: "Senior Product Designer, Payments" })).toBeVisible({ timeout: 30_000 });
  await shot(page, "agent");
});

test("an agent search: titles, places, filters and what to skip", async ({ page }) => {
  await page.goto("/settings?section=agent");
  await expect(page.getByText("Product Design Lead").first()).toBeVisible({ timeout: 15_000 });
  await page.getByText("Product Design Lead").first().scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -250);
  await shot(page, "agent-search");
});

test("scoring: your own rubric and preferences", async ({ page }) => {
  await page.goto("/settings?section=scoring");
  await shot(page, "scoring");
});

test("manual job search with filters", async ({ page }) => {
  await page.goto("/jobs");
  await page.getByRole("search", { name: "Search postings" }).getByRole("button", { name: "Search" }).click();
  await page.waitForTimeout(3_000);
  await shot(page, "find-jobs");
});

test("an application: tailored resume, ATS grade and the chat", async ({ page }) => {
  const [ledgerly] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  await page.goto(`/applications/${ledgerly.id}`);
  await expect(page.getByRole("article", { name: "Resume" })).toContainText("Jane Doe");
  await shot(page, "application");
});

test("the base resume at a page length", async ({ page }) => {
  await page.goto("/resume");
  await shot(page, "resume");
});

test("the dashboard", async ({ page }) => {
  await page.goto("/");
  await shot(page, "dashboard");
});

test("the board", async ({ page }) => {
  await page.goto("/applications?filter=active");
  await shot(page, "applications");
});

test("the profile", async ({ page }) => {
  await page.goto("/profile");
  await shot(page, "profile");
});
