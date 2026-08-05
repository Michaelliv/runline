import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { SESSION_OPTIONS_SCHEMA, api, apiKey, compactRecord } from "./shared.js";

const SCRAPE_SCHEMA = {
  url: t.String({ description: "URL to scrape" }),
  format: t.Optional(t.Array(t.String(), { description: "Formats: html, cleaned_html, markdown, readability" })),
  delay: t.Optional(t.Number({ description: "Milliseconds to wait after navigation" })),
  useProxy: t.Optional(t.Any({ description: "true or proxy config" })),
  screenshot: t.Optional(t.Boolean({ description: "Also capture a screenshot URL" })),
  pdf: t.Optional(t.Boolean({ description: "Also capture a PDF URL" })),
} as const;

const SCREENSHOT_SCHEMA = {
  url: t.String({ description: "URL to screenshot" }),
  fullPage: t.Optional(t.Boolean({ description: "Capture full scrollable page" })),
  delay: t.Optional(t.Number({ description: "Milliseconds to wait after navigation" })),
  useProxy: t.Optional(t.Any({ description: "true or proxy config" })),
} as const;

async function scrape(input: unknown, ctx: Parameters<NonNullable<Parameters<RunlinePluginAPI["registerAction"]>[1]["execute"]>>[1]) {
  return api(ctx, "/v1/scrape", { method: "POST", body: compactRecord(input as Record<string, unknown>) });
}

async function screenshot(input: unknown, ctx: Parameters<NonNullable<Parameters<RunlinePluginAPI["registerAction"]>[1]["execute"]>>[1]) {
  return api(ctx, "/v1/screenshot", { method: "POST", body: compactRecord(input as Record<string, unknown>) });
}

export function registerBrowserActions(rl: RunlinePluginAPI) {
  rl.registerAction("scrape", {
    access: "write",
    description: "One-shot Steel scrape. Loads a URL and returns requested formats such as markdown, html, cleaned_html, or readability.",
    inputSchema: t.Object(SCRAPE_SCHEMA),
    execute: scrape,
  });

  rl.registerAction("browser.scrape", {
    access: "write",
    description: "Backward-compatible alias for scrape.",
    inputSchema: t.Object(SCRAPE_SCHEMA),
    execute: scrape,
  });

  rl.registerAction("screenshot", {
    access: "write",
    description: "One-shot Steel screenshot. Returns a hosted PNG URL.",
    inputSchema: t.Object(SCREENSHOT_SCHEMA),
    execute: screenshot,
  });

  rl.registerAction("browser.screenshot", {
    access: "write",
    description: "Backward-compatible alias for screenshot.",
    inputSchema: t.Object(SCREENSHOT_SCHEMA),
    execute: screenshot,
  });

  rl.registerAction("browser.extract", {
    access: "write",
    description: "Fetch a page through Steel scrape and return selected content fields. Use selectors with browser.run for DOM-specific extraction.",
    inputSchema: t.Object({
      url: t.String({ description: "URL to scrape" }),
      format: t.Optional(t.Array(t.String(), { description: "Formats to request; defaults to markdown and html" })),
      delay: t.Optional(t.Number({ description: "Milliseconds to wait after navigation" })),
      useProxy: t.Optional(t.Any({ description: "true or proxy config" })),
    }),
    async execute(input, ctx) {
      const body = { format: ["markdown", "html"], ...(input as Record<string, unknown>) };
      return api(ctx, "/v1/scrape", { method: "POST", body: compactRecord(body) });
    },
  });

  rl.registerAction("pdf", {
    access: "write",
    description: "One-shot Steel PDF capture. Returns a hosted PDF URL.",
    inputSchema: t.Object({
      url: t.String({ description: "URL to render as PDF" }),
      delay: t.Optional(t.Number({ description: "Milliseconds to wait after navigation" })),
      useProxy: t.Optional(t.Any({ description: "true or proxy config" })),
    }),
    async execute(input, ctx) {
      return api(ctx, "/v1/pdf", { method: "POST", body: compactRecord(input as Record<string, unknown>) });
    },
  });

  rl.registerAction("browser.run", {
    access: "write",
    description: "Create a Steel session, connect with real Playwright over CDP, run an async JavaScript script, then release by default. The script receives the genuine Playwright { page, browser, context } plus session. Requires the host app to have playwright installed — this action fails rather than degrading if it is missing. For automation that works without a Playwright install, prefer the page.* actions, which drive the page semantically over CDP.",
    inputSchema: t.Object({
      script: t.String({ description: "Async JavaScript body. Example: await page.goto('https://example.com'); return { title: await page.title() };" }),
      release: t.Optional(t.Boolean({ description: "Release the Steel session after the script finishes (default true)" })),
      ...SESSION_OPTIONS_SCHEMA,
    }),
    async execute(input, ctx) {
      const { script, release, ...sessionOptions } = input as Record<string, unknown> & { script: string; release?: boolean };
      let playwright: typeof import("playwright");
      try {
        playwright = await import("playwright");
      } catch (_error) {
        throw new Error(
          "steel.browser.run needs playwright installed in the host project. " +
            "Install it, or use the steel.page.* actions, which need nothing installed.",
        );
      }

      const session = await api(ctx, "/v1/sessions", { method: "POST", body: compactRecord(sessionOptions) }) as Record<string, unknown>;
      const cdpUrl = `wss://connect.steel.dev?apiKey=${encodeURIComponent(apiKey(ctx))}&sessionId=${encodeURIComponent(String(session.id))}`;
      let browser: Awaited<ReturnType<typeof playwright.chromium.connectOverCDP>> | undefined;
      try {
        // No fallback shim on purpose. A hand-rolled lookalike that
        // answers to the same names but implements a fraction of the API
        // does not fail — it returns wrong results, which is worse.
        browser = await playwright.chromium.connectOverCDP(cdpUrl, { timeout: 30000 });
        const context = browser.contexts()[0] ?? await browser.newContext();
        const page = context.pages()[0] ?? await context.newPage();
        const fn = new Function("page", "browser", "context", "session", `return (async () => {\n${script}\n})();`);
        const result = await fn(page, browser, context, session);
        return { session, result };
      } finally {
        await browser?.close()?.catch?.(() => {});
        if (release !== false && session.id) {
          await api(ctx, `/v1/sessions/${encodeURIComponent(String(session.id))}/release`, { method: "POST" }).catch(() => {});
        }
      }
    },
  });
}
