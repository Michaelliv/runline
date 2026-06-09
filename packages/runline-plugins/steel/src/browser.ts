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

type PendingCdp = { resolve: (value: unknown) => void; reject: (error: Error) => void };

async function connectMiniCdp(cdpUrl: string) {
  const ws = new WebSocket(cdpUrl);
  let nextId = 0;
  const pending = new Map<number, PendingCdp>();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP websocket connection timed out")), 30000);
    ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP websocket connection failed")); }, { once: true });
  });
  ws.addEventListener("message", (event) => {
    let message: Record<string, unknown>;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (typeof message.id !== "number") return;
    const wait = pending.get(message.id);
    if (!wait) return;
    pending.delete(message.id);
    if (message.error) wait.reject(new Error(JSON.stringify(message.error)));
    else wait.resolve(message.result);
  });
  const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) => new Promise<unknown>((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`CDP ${method} timed out`));
    }, 30000);
  });
  const targets = await send("Target.getTargets") as { targetInfos?: Array<{ targetId: string; type: string }> };
  const target = targets.targetInfos?.find((info) => info.type === "page") ?? targets.targetInfos?.[0];
  if (!target) throw new Error("Steel CDP session has no browser target");
  const attached = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }) as { sessionId: string };
  const sid = attached.sessionId;
  const evaluate = async (expression: string) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sid) as { result?: { value?: unknown } };
    return result.result?.value;
  };
  const page = {
    async goto(url: string, _options?: unknown) {
      await send("Page.navigate", { url }, sid);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return null;
    },
    title: () => evaluate("document.title"),
    url: () => evaluate("location.href"),
    text: () => evaluate("document.body?.innerText ?? ''"),
    html: () => evaluate("document.documentElement?.outerHTML ?? ''"),
    evaluate: (expression: string) => evaluate(`(${expression})()`),
  };
  return { page, browser: { close: () => ws.close() }, context: {}, close: () => ws.close() };
}

export function registerBrowserActions(rl: RunlinePluginAPI) {
  rl.registerAction("scrape", {
    description: "One-shot Steel scrape. Loads a URL and returns requested formats such as markdown, html, cleaned_html, or readability.",
    inputSchema: t.Object(SCRAPE_SCHEMA),
    execute: scrape,
  });

  rl.registerAction("browser.scrape", {
    description: "Backward-compatible alias for scrape.",
    inputSchema: t.Object(SCRAPE_SCHEMA),
    execute: scrape,
  });

  rl.registerAction("screenshot", {
    description: "One-shot Steel screenshot. Returns a hosted PNG URL.",
    inputSchema: t.Object(SCREENSHOT_SCHEMA),
    execute: screenshot,
  });

  rl.registerAction("browser.screenshot", {
    description: "Backward-compatible alias for screenshot.",
    inputSchema: t.Object(SCREENSHOT_SCHEMA),
    execute: screenshot,
  });

  rl.registerAction("browser.extract", {
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
    description: "Create a Steel session, connect with Playwright over CDP, run an async JavaScript script, then release by default. The script receives { page, browser, context, session }. Requires the host app to have playwright installed.",
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
        throw new Error("steel.browser.run requires the host project to install playwright. Install playwright or use session.create + session.cdpUrl instead.");
      }

      const session = await api(ctx, "/v1/sessions", { method: "POST", body: compactRecord(sessionOptions) }) as Record<string, unknown>;
      const cdpUrl = `wss://connect.steel.dev?apiKey=${encodeURIComponent(apiKey(ctx))}&sessionId=${encodeURIComponent(String(session.id))}`;
      let browser: { close: () => Promise<void> | void } | undefined;
      try {
        let context: unknown;
        let page: unknown;
        try {
          const playwrightBrowser = await playwright.chromium.connectOverCDP(cdpUrl, { timeout: 30000 });
          browser = playwrightBrowser;
          context = playwrightBrowser.contexts()[0] ?? await playwrightBrowser.newContext();
          page = context.pages()[0] ?? await context.newPage();
        } catch {
          const mini = await connectMiniCdp(cdpUrl);
          browser = mini.browser;
          context = mini.context;
          page = mini.page;
        }
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
