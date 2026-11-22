import { createHash } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { sql } from "./support";

// Scout's README screenshots, from the demo data (Jane Doe is made up) with the
// fake AI and job sources: see playwright.scout-readme.config.ts.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, timezoneId: "America/New_York", locale: "en-US" });
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
  const query = { keywords: "Product designer", place: "", country: "us", radiusKm: 25, remoteOnly: false, postedWithin: "3days", workModes: ["hybrid", "remote"], levels: ["senior"], minSalary: 110000 };
  await sql(
    `INSERT INTO "AgentSearch" (id, name, query, enabled, position, "maxPages", "skipRules", places, "altTitles", "updatedAt") VALUES ('readme-search', 'Product designer', $1, true, 0, 1, $2, $3, $4, now())`,
    [JSON.stringify(query), "Intern\nContract-to-hire", "Arlington, VA\nWashington, DC\nReston, VA", "UX Designer\nProduct Design Lead"],
  );
  await sql(`INSERT INTO "Setting" (key, value, "updatedAt") VALUES ('agentEnabled', 'true', now()) ON CONFLICT (key) DO UPDATE SET value = 'true'`);
  // Jane lives in Arlington, VA: her times are New York's, whatever the computer taking the pictures says.
  await sql(`INSERT INTO "Setting" (key, value, "updatedAt") VALUES ('browserTimeZone', 'America/New_York', now()) ON CONFLICT (key) DO UPDATE SET value = 'America/New_York'`);
  // Her scoring: distance in miles from her ZIP code, and a US pay range.
  const prefs = { fitPoints: 60, work: { points: 20, remote: 100, hybrid: 70, onsite: 30, unknown: 40 }, pay: { points: 15, low: 120000, high: 160000, unknown: 50 }, place: { points: 5, zip: "22209", miles: 30, ruleOutFar: true, unknown: 50 }, ruleOut: [], fresh: { hours: 12, points: 5 } };
  await sql(`INSERT INTO "Setting" (key, value, "updatedAt") VALUES ('scoringPrefs', $1, now()) ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(prefs)]);
  // What a run leaves on the Agent screen (made-up postings): scored against Jane's profile, with reasons and the breakdown.
  const line = (label: string, earned: number, points: number, verdict: string, note: string) => ({ label, earned, points, verdict, note });
  const postings = [
    { id: "c1", title: "Senior Product Designer, Payments", company: "Ledgerly", place: "Washington, DC", remote: false, salary: "$130,000–$150,000", hours: 2, score: 92, reasons: ["Led a design system used by 40 engineers, as the posting asks.", "Six years of product design in fintech and logistics.", "Posted 2 hours ago: +5 for applying early."], flags: [] },
    { id: "c2", title: "Product Design Lead", company: "Kestrel Maps", place: "Arlington, VA", remote: true, salary: "$145,000–$165,000", hours: 20, score: 86, reasons: ["Leads designers and runs research, both in her recent roles.", "Prototyping in Figma matches the core of the role."], flags: [] },
    { id: "c3", title: "UX Designer, Logistics", company: "Northwind Logistics", place: "Reston, VA", remote: false, salary: "", hours: 30, score: 79, reasons: ["Freight and logistics experience from her current job.", "User research and usability testing are her strengths."], flags: ["Pay isn't listed."] },
    { id: "c4", title: "Senior UX Designer", company: "Fieldnote", place: "Washington, DC", remote: true, salary: "$125,000–$140,000", hours: 40, score: 74, reasons: ["Design systems and accessibility work fit what they ask for."], flags: ["Asks for a Public Trust clearance."] },
    { id: "c5", title: "Product Designer (Contract)", company: "Studio Brik", place: "Baltimore, MD", remote: false, salary: "$70/hour", hours: 44, score: 61, reasons: ["A good fit on skills."], flags: ["A six-month contract.", "On-site five days a week."] },
  ];
  for (const [index, posting] of postings.entries()) {
    const breakdown = [
      line("How well it fits your profile", Math.round(posting.score * 0.6), 60, "score", `Scored ${posting.score} of 100`),
      line(`Work style: ${posting.remote ? "Remote" : "Hybrid"}`, posting.remote ? 20 : 14, 20, "yours", posting.remote ? "Remote gets all of these points" : "Hybrid gets 70% of these points"),
      line(posting.salary ? `Pay: ${posting.salary}` : "Pay: not listed", posting.salary ? 13 : 7.5, 15, "yours", "Compared with your range"),
      line(posting.remote ? "Distance: remote" : "Distance: about 8 miles", 5, 5, "yours", posting.remote ? "Remote, so distance doesn't matter" : "Your limit is 30 miles"),
    ];
    await sql(
      `INSERT INTO "AgentCandidate" (id, source, "externalId", title, company, place, remote, salary, "postedAt", url, via, description, complete, score, reasons, "redFlags", breakdown, status, "dedupeKey", "searchId", "createdAt", "updatedAt")
       VALUES ($1, 'JSEARCH', $1, $2, $3, $4, $5, $6, now() - ($7 || ' hours')::interval, $8, 'LinkedIn', $9, true, $10, $11, $12, $13, 'SCORED', $1, 'readme-search', now() - ($14 || ' minutes')::interval, now())`,
      [`readme-${posting.id}`, posting.title, posting.company, posting.place, posting.remote, posting.salary, String(posting.hours), `https://example.com/jobs/${posting.id}`, `${posting.company} is hiring a ${posting.title}.`, posting.score, JSON.stringify(posting.reasons), JSON.stringify(posting.flags), JSON.stringify(breakdown), String(index * 3)],
    );
  }
  // Three it set aside before scoring, by Jane's settings: too far, or a title she skips.
  for (const [id, title, reason] of [
    ["s1", "Product Designer", "Set aside before scoring, by your settings: within 30 miles (On-site, about 140 miles from 22209)."],
    ["s2", "Design Intern", "Skipped by its title: “Intern” is on your Job titles to skip."],
    ["s3", "Senior Product Designer", "Set aside before scoring, by your settings: within 30 miles (Hybrid, about 95 miles from 22209)."],
  ]) {
    await sql(
      `INSERT INTO "AgentCandidate" (id, source, "externalId", title, company, place, score, "redFlags", status, "dedupeKey", "searchId", "createdAt", "updatedAt")
       VALUES ($1, 'JSEARCH', $1, $2, 'Elsewhere Co', 'Philadelphia, PA', 0, $3, 'DISMISSED', $1, 'readme-search', now() - interval '50 minutes', now())`,
      [`readme-${id}`, title, JSON.stringify([reason])],
    );
  }
  // The run that found them, a few minutes before the first: the tiles count what became of its postings.
  // Timed from the rows themselves, as the database's clock wrote them.
  const [first] = await sql<{ at: string }>(`SELECT to_char(min("createdAt") - interval '5 minutes', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at FROM "AgentCandidate"`);
  await sql(`INSERT INTO "Setting" (key, value, "updatedAt") VALUES ('agentRuns', $1, now()) ON CONFLICT (key) DO UPDATE SET value = $1`, [
    JSON.stringify([{ at: first.at, manual: false, message: "8 new postings scored." }]),
  ]);
  // The top one is on Saved for later, so its card shows the button lit up.
  await sql(`DELETE FROM "Posting" WHERE "externalId" LIKE 'readme-%'`);
  await sql(
    `INSERT INTO "Posting" (id, source, "externalId", title, company, place, url, description, complete, "savedAt", "updatedAt")
     VALUES ('readme-saved-c1', 'JSEARCH', 'readme-c1', 'Senior Product Designer, Payments', 'Ledgerly', 'Washington, DC', 'https://example.com/jobs/c1', 'Ledgerly is hiring a Senior Product Designer, Payments.', true, now(), now())`,
  );
});

test("the agentic job search: found, scored and ranked", async ({ page }) => {
  await page.goto("/agent");
  await expect(page.getByRole("heading", { level: 3, name: "Senior Product Designer, Payments" })).toBeVisible({ timeout: 30_000 });
  await shot(page, "agent");
});

test("questions that keep coming up: answered once for several drafts", async ({ page }) => {
  // Two drafts that each miss the same five things, grouped into topics as the AI groups them.
  const drafts = await sql<{ id: string; company: string }>(`SELECT id, company FROM "Application" WHERE company IN ('Ledgerly', 'Brightline Transit') ORDER BY id`);
  const topics = [
    ["Accessibility audits (WCAG 2.1 AA)", "Ran WCAG 2.1 AA accessibility audits on the design system and fixed what they found.", "Mention accessibility audits against WCAG 2.1 AA, if you've run them."],
    ["Usability testing with customers", "Ran moderated usability tests with customers every sprint.", "Say how often you test designs with real users."],
    ["Owning a design system", "Owned the design system used by 40 engineers, from tokens to components.", "Name the design system you owned and who used it."],
    ["Handoff to engineers in Figma Dev Mode", "Handed off specs to engineers in Figma Dev Mode.", "Mention working with engineers through Figma Dev Mode."],
    ["Payments or fintech experience", "Designed invoicing and payout flows for small-business customers.", "Bring forward any payments or fintech work."],
  ];
  for (const draft of drafts) {
    await sql(`UPDATE "Application" SET status = 'DRAFT', "archivedAt" = NULL, "resumeSuggestions" = $2, "dismissedSuggestions" = '{}' WHERE id = $1`, [draft.id, topics.map(([, , text]) => text)]);
  }
  const items = drafts.flatMap((draft) => topics.map(([, , text]) => [draft.id, text]));
  // The fingerprint the app keeps, so it doesn't group them again with the fake AI.
  const stamp = createHash("sha1").update(JSON.stringify(items)).digest("hex").slice(0, 16);
  const recurring = {
    stamp,
    topics: topics.map(([topic, guess, text]) => ({ topic, roleId: null, guess, items: drafts.map((draft) => ({ applicationId: draft.id, company: draft.company, text })) })),
  };
  await sql(`INSERT INTO "Setting" (key, value, "updatedAt") VALUES ('recurringTopics', $1, now()) ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(recurring)]);
  await sql(`INSERT INTO "Setting" (key, value, "updatedAt") VALUES ('topicDecisions', '{}', now()) ON CONFLICT (key) DO UPDATE SET value = '{}'`);
  await page.goto("/agent");
  const open = page.getByRole("button", { name: /Click here to review and fix/ });
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
  await expect(page.getByText("1–3 of 5")).toBeVisible();
  // The whole box in view, its pages at the bottom, with the tiles above it.
  await page.getByRole("region", { name: "Questions that keep coming up" }).evaluate((box) => box.scrollIntoView({ block: "end" }));
  await shot(page, "recurring");
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
  const [ledgerly] = await sql<{ id: string; postingText: string }>(`SELECT id, "postingText" FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  // The whole posting, as a real one reads: the demo's is only its start, which the resume tab would flag as cut short.
  if (ledgerly.postingText.trim().length < 1200) {
    await sql(`UPDATE "Application" SET "postingText" = "postingText" || $2 WHERE id = $1`, [
      ledgerly.id,
      [
        "",
        "",
        "What you'll do",
        "- Own the end-to-end design of Ledgerly's payments experience, from invoice to payout, for small businesses across the US.",
        "- Work with product managers and engineers from discovery through launch, and measure what changed once it ships.",
        "- Run regular research with customers and support teams, and turn what you learn into clear, testable designs.",
        "- Grow and maintain our design system with the engineers who build it, so every team ships consistent, accessible screens.",
        "- Mentor other designers and share your work openly in critiques.",
        "",
        "What we offer",
        "- Hybrid work from our Washington, DC office, three days a week.",
        "- Health, dental and vision coverage, a 401(k) match and a yearly learning budget.",
        "- Flexible time off and paid parental leave.",
      ].join("\n"),
    ]);
  }
  // A wide window, as on a desktop monitor: the suggestions beside the resume, the chat on the right.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`/applications/${ledgerly.id}`);
  await expect(page.getByRole("article", { name: "Resume" })).toContainText("Jane Doe");
  await shot(page, "application");
});

test("a cover letter, written for the job", async ({ page }) => {
  const [ledgerly] = await sql<{ id: string }>(`SELECT id FROM "Application" WHERE company = 'Ledgerly' LIMIT 1`);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`/applications/${ledgerly.id}?tab=letter`);
  await expect(page.getByRole("tab", { name: /cover letter/i, selected: true })).toBeVisible({ timeout: 15_000 });
  await shot(page, "cover-letter");
});

test("estimated cost and spending limits", async ({ page }) => {
  await page.goto("/settings?section=costs");
  // The spending limits in view, with what's been spent above them.
  await page.getByText("Cost limits", { exact: true }).first().scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 500);
  await shot(page, "costs");
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
