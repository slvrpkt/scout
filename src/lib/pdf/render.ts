import "server-only";

import { chromium, type Browser } from "playwright-core";

import { countPdfPages } from "./pages";
import { PRINT_TOKEN_HEADER, signPrintToken } from "./print-token";

// PDFs are printed by headless Chromium from the app's own print pages, so
// they match the preview (RES-5, RES-7). One browser is shared by every
// render and relaunched if it crashes; a few pages print at once and the
// rest wait their turn. After a while without renders the browser closes to
// give its memory back, and the next render starts it again.

/**
 * Pages printed at the same time; the rest queue. Measured with 2 vCPUs and
 * 1 GB (E11-6): a render takes about 0.25 s, so more at once only shares the
 * CPU; six requested together finish in 1.4 s at a peak of 520 MB.
 */
export const MAX_CONCURRENT_RENDERS = 2;
/** Close the browser after this long without a render: long enough that a working session never waits for it to start again. */
const IDLE_MS = 30 * 60_000;
const NAVIGATION_TIMEOUT_MS = 20_000;

type Pool = {
  browser: Promise<Browser> | null;
  active: number;
  queue: (() => void)[];
  idleTimer: ReturnType<typeof setTimeout> | null;
};

// Kept on globalThis so the dev server's hot reloads don't leak browsers.
const globalForPdf = globalThis as unknown as { pdfPool?: Pool };
const pool: Pool = (globalForPdf.pdfPool ??= { browser: null, active: 0, queue: [], idleTimer: null });

const pagePath = (path: string) => path.split("?")[0];

const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Chromium's page header: small and faded, on one line in the top margin at the right. */
export const runningHeaderHtml = (lines: string) =>
  `<div style="width:100%;padding:3mm 15mm 0 0;font-family:Calibri,Arial,sans-serif;font-size:7.5pt;line-height:1;color:#9a9a9a;text-align:right">${lines.split("\n").map(escaped).join(" &nbsp;·&nbsp; ")}</div>`;

/** Chromium's header is on every page or none: page one from `first`, the rest from `later`. */
async function laterPagesFrom(first: Uint8Array, later: Uint8Array): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const [from, rest, out] = await Promise.all([PDFDocument.load(first), PDFDocument.load(later), PDFDocument.create()]);
  out.addPage((await out.copyPages(from, [0]))[0]);
  for (const page of await out.copyPages(rest, rest.getPageIndices().slice(1))) out.addPage(page);
  // Plain page objects, not compressed object streams, so countPdfPages can read them (pages.ts).
  return out.save({ useObjectStreams: false });
}

/** Where the app itself is listening, for Chromium to open print pages. */
function appOrigin(): string {
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

function browser(): Promise<Browser> {
  if (!pool.browser) {
    const launching = chromium
      .launch({
        // Docker gives /dev/shm only 64 MB.
        args: ["--disable-dev-shm-usage"],
      })
      .then((launched) => {
        // A crashed or closed browser is replaced on the next render.
        launched.on("disconnected", () => {
          if (pool.browser === launching) pool.browser = null;
        });
        return launched;
      });
    launching.catch(() => {
      if (pool.browser === launching) pool.browser = null;
    });
    pool.browser = launching;
  }
  return pool.browser;
}

async function acquire(): Promise<void> {
  if (pool.idleTimer) clearTimeout(pool.idleTimer);
  pool.idleTimer = null;
  if (pool.active < MAX_CONCURRENT_RENDERS) {
    pool.active += 1;
    return;
  }
  // The slot is handed over by release(), so `active` stays the same.
  await new Promise<void>((resolve) => pool.queue.push(resolve));
}

function release(): void {
  const next = pool.queue.shift();
  if (next) return next();
  pool.active -= 1;
  if (pool.active === 0) closeWhenIdle();
}

/** Closes the browser after IDLE_MS without a render, to give its memory back. */
function closeWhenIdle(): void {
  if (pool.idleTimer) clearTimeout(pool.idleTimer);
  pool.idleTimer = setTimeout(() => {
    const closing = pool.browser;
    pool.browser = null;
    void closing?.then((open) => open.close()).catch(() => {});
  }, IDLE_MS);
  pool.idleTimer.unref?.();
}

/** Starts the browser in the background (at startup), so the first PDF doesn't wait for Chromium; unused, it closes after IDLE_MS. */
export function warmPdfBrowser(): void {
  void browser()
    .then(() => {
      if (pool.active === 0) closeWhenIdle();
    })
    .catch(() => {});
}

/**
 * Prints an app page (e.g. "/print/base") to a PDF at the page size its
 * print CSS sets. Chromium may only talk to the app: anything else is
 * blocked, so fonts come from the bundle and nothing leaves the server.
 */
export async function renderPdf(path: string): Promise<Uint8Array> {
  await acquire();
  try {
    const origin = appOrigin();
    const context = await (await browser()).newContext({
      // The token opens the page, whatever its query says.
      extraHTTPHeaders: { [PRINT_TOKEN_HEADER]: await signPrintToken(pagePath(path)) },
    });
    try {
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"),
      );
      const page = await context.newPage();
      const response = await page.goto(`${origin}${path}`, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
      if (!response?.ok()) throw new Error(`The print page ${path} answered ${response?.status() ?? "nothing"}.`);
      // Sent elsewhere, such as to sign in: that page must never go out as a resume.
      if (new URL(page.url()).pathname !== pagePath(path)) throw new Error(`The print page ${path} ended up at ${new URL(page.url()).pathname}.`);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      // A resume's later pages carry faded contact lines at the top right; page one has them already.
      const header = await page.evaluate(() => document.querySelector('meta[name="running-header"]')?.getAttribute("content") ?? "");
      if (!header || countPdfPages(pdf) < 2) return pdf;
      return laterPagesFrom(pdf, await page.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true, headerTemplate: runningHeaderHtml(header), footerTemplate: "<span></span>" }));
    } finally {
      await context.close();
    }
  } finally {
    release();
  }
}
