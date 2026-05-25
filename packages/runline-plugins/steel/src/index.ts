/**
 * Steel.dev cloud-browser plugin for runline.
 *
 * Gives an agent a real cloud browser (Steel.dev) for web tasks that plain HTTP
 * fetch cannot do: JavaScript-rendered pages, anti-bot "verify you're not a
 * robot" walls, and structured extraction from live pages.
 *
 * Auth: a Steel API key (header `steel-api-key`), set via the `steelApiKey`
 * connection field (env `STEEL_API_KEY`). Optionally route through a residential
 * proxy (`steelProxyUrl` / `STEEL_PROXY_URL`) for surfaces that block
 * datacenter IPs — only when an action passes `useProxy: true`.
 *
 *   await steel.browser.scrape({ url: "https://example.com" })
 *   await steel.browser.extract({ url, selectors: { title: "h1", price: ".price" } })
 *   await steel.browser.screenshot({ url })  // returns a public imageUrl
 *
 * Read-only: this plugin navigates and extracts; it does not submit forms or
 * mutate remote state. It never returns the Steel API key or proxy credentials.
 */
import type { ActionContext, RunlinePluginAPI } from "runline";

const NAME = "steel";
const DEFAULT_STEEL_BASE = "https://api.steel.dev";

type Ctx = ActionContext;

interface SteelConfig {
  steelApiKey: string;
  steelBaseUrl: string;
  steelProxyUrl: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function compactText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampWait(value: unknown, fallback = 9000, max = 45000): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function getConnectionConfig(ctx: Ctx): SteelConfig {
  const cfg = (ctx?.connection?.config ?? {}) as Record<string, string>;
  return {
    steelApiKey: compactText(cfg.steelApiKey),
    steelBaseUrl:
      compactText(cfg.steelBaseUrl || DEFAULT_STEEL_BASE).replace(/\/+$/, ""),
    steelProxyUrl: compactText(cfg.steelProxyUrl),
  };
}

// ── Steel client ─────────────────────────────────────────────────────

interface SteelSession {
  id: string;
  websocketUrl: string;
  sessionViewerUrl?: string;
}

class SteelClient {
  apiKey: string;
  baseUrl: string;
  proxyUrl: string;

  constructor(cfg: SteelConfig) {
    if (!cfg.steelApiKey) {
      throw new Error(
        "Missing STEEL_API_KEY. Configure it before using the steel browser plugin.",
      );
    }
    this.apiKey = cfg.steelApiKey;
    this.baseUrl = cfg.steelBaseUrl || DEFAULT_STEEL_BASE;
    this.proxyUrl = cfg.steelProxyUrl;
  }

  async request(method: string, pathname: string, body?: unknown): Promise<any> {
    const resp = await fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers: { "steel-api-key": this.apiKey, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`Steel ${method} ${pathname} -> ${resp.status}: ${text.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) : {};
  }

  async createSession(
    { useProxy = false, timeout = 180000 }: { useProxy?: boolean; timeout?: number } = {},
  ): Promise<SteelSession> {
    const body: Record<string, unknown> = { timeout };
    if (useProxy) {
      if (!this.proxyUrl) throw new Error("useProxy requested but STEEL_PROXY_URL is not configured.");
      body.proxyUrl = this.proxyUrl;
    }
    return this.request("POST", "/v1/sessions", body);
  }

  async release(sessionId: string): Promise<unknown> {
    try {
      return await this.request("POST", `/v1/sessions/${sessionId}/release`);
    } catch {
      return { success: false };
    }
  }

  // Steel's hosted screenshot API stores the image on images.steel.dev and
  // returns a PUBLIC URL (no auth) that renders inline in chat — the bytes
  // never have to traverse the agent runtime (which strips large base64).
  async hostedScreenshot(
    { url, fullPage = false, delay, useProxy = false }: { url: string; fullPage?: boolean; delay?: number; useProxy?: boolean },
  ): Promise<string | null> {
    const body: Record<string, unknown> = { url };
    if (fullPage) body.fullPage = true;
    if (Number.isFinite(delay) && (delay as number) > 0) body.delay = delay;
    if (useProxy) {
      if (!this.proxyUrl) throw new Error("useProxy requested but STEEL_PROXY_URL is not configured.");
      body.proxyUrl = this.proxyUrl;
    }
    const res = await this.request("POST", "/v1/screenshot", body);
    return res?.url || null;
  }
}

// ── Minimal CDP driver ───────────────────────────────────────────────

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
}

class CdpConnection {
  wsUrl: string;
  nextId = 0;
  pending = new Map<number, Pending>();
  ws: WebSocket | null = null;

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof WebSocket === "undefined") {
        reject(new Error("Global WebSocket is not available in this runtime; the steel browser plugin needs Node 22+ / Bun."));
        return;
      }
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const onError = () => reject(new Error("Steel CDP websocket connection failed"));
      ws.addEventListener("open", () => {
        ws.removeEventListener("error", onError as EventListener);
        resolve();
      });
      ws.addEventListener("error", onError as EventListener);
      ws.addEventListener("close", () => {
        for (const [, p] of this.pending) p.reject(new Error("Steel CDP connection closed"));
        this.pending.clear();
      });
      ws.addEventListener("message", (ev: MessageEvent) => {
        let msg: any;
        try {
          msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
        } catch {
          return;
        }
        if (msg.id != null && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message || "CDP error"));
          else p.resolve(msg.result);
        }
      });
    });
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 45000): Promise<any> {
    const requestId = ++this.nextId;
    const payload: Record<string, unknown> = { id: requestId, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        this.ws!.send(JSON.stringify(payload));
      } catch (err) {
        this.pending.delete(requestId);
        reject(err as Error);
        return;
      }
      setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
    });
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {
      /* noop */
    }
  }
}

class PageDriver {
  conn: CdpConnection;
  sessionId: string;

  constructor(conn: CdpConnection, sessionId: string) {
    this.conn = conn;
    this.sessionId = sessionId;
  }

  static async attachFirstPage(conn: CdpConnection): Promise<PageDriver> {
    const { targetInfos } = await conn.send("Target.getTargets");
    let target = (targetInfos || []).find((t: any) => t.type === "page");
    if (!target) {
      const created = await conn.send("Target.createTarget", { url: "about:blank" });
      target = { targetId: created.targetId };
    }
    const { sessionId } = await conn.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const driver = new PageDriver(conn, sessionId);
    await conn.send("Page.enable", {}, sessionId);
    await conn.send("Runtime.enable", {}, sessionId);
    return driver;
  }

  async navigate(url: string): Promise<void> {
    await this.conn.send("Page.navigate", { url }, this.sessionId);
  }

  async eval(expression: string): Promise<any> {
    const r = await this.conn.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      this.sessionId,
    );
    if (r.exceptionDetails) {
      throw new Error(`page eval failed: ${r.exceptionDetails.text || r.exceptionDetails.exception?.description || "exception"}`);
    }
    return r.result?.value;
  }
}

// Render a URL in a Steel browser and run a callback with the live PageDriver.
async function withRenderedPage(
  cfg: SteelConfig,
  { url, useProxy = false, waitMs = 9000, waitSelector }: { url: string; useProxy?: boolean; waitMs?: number; waitSelector?: string },
  fn: (page: PageDriver, meta: { sessionId: string; viewer?: string }) => Promise<any>,
): Promise<any> {
  const steel = new SteelClient(cfg);
  const session = await steel.createSession({ useProxy });
  const wsUrl = `${session.websocketUrl}${session.websocketUrl.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(steel.apiKey)}`;
  const conn = new CdpConnection(wsUrl);
  try {
    await conn.connect();
    const page = await PageDriver.attachFirstPage(conn);
    await page.navigate(url);
    await sleep(Math.min(waitMs, 6000));
    if (waitSelector) {
      const deadline = Date.now() + Math.max(0, waitMs - 6000);
      while (Date.now() < deadline) {
        const found = await page.eval(`!!document.querySelector(${JSON.stringify(waitSelector)})`);
        if (found) break;
        await sleep(1500);
      }
    } else if (waitMs > 6000) {
      await sleep(waitMs - 6000);
    }
    return await fn(page, { sessionId: session.id, viewer: session.sessionViewerUrl });
  } finally {
    conn.close();
    await steel.release(session.id);
  }
}

function robotWallExpr(): string {
  return `/are you a human|verify you('| a)re not a robot|not a robot|enable javascript|access denied|unusual traffic/i.test((document.body && document.body.innerText || '').slice(0, 4000))`;
}

// ── Plugin registration ──────────────────────────────────────────────

export default function steel(rl: RunlinePluginAPI): void {
  rl.setName(NAME);
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    steelApiKey: {
      type: "string",
      required: true,
      env: "STEEL_API_KEY",
      description: "Steel.dev API key for the cloud browser. Store only in secrets.",
    },
    steelBaseUrl: {
      type: "string",
      required: false,
      env: "STEEL_API_BASE",
      default: DEFAULT_STEEL_BASE,
      description: "Steel.dev API base URL.",
    },
    steelProxyUrl: {
      type: "string",
      required: false,
      env: "STEEL_PROXY_URL",
      description: "Residential proxy URL, used only when an action passes useProxy:true. Store only in secrets.",
    },
  });

  rl.registerAction("browser.scrape", {
    description:
      "Render a URL in a real Steel cloud browser (executes JavaScript, passes 'verify you're not a robot' walls) and return its content. Use this instead of plain fetch for JS-heavy or anti-bot pages. No proxy by default; set useProxy:true only for datacenter-IP-blocked surfaces.",
    inputSchema: {
      url: { type: "string", required: true, description: "Absolute URL to render." },
      format: { type: "string", required: false, default: "text", description: "text (visible innerText), html (rendered outerHTML), or links (anchor list)." },
      waitMs: { type: "number", required: false, default: 9000, description: "How long to let the page render (ms, max 45000)." },
      waitSelector: { type: "string", required: false, description: "Optional CSS selector to wait for before extracting." },
      maxChars: { type: "number", required: false, default: 20000, description: "Cap on returned content length." },
      useProxy: { type: "boolean", required: false, default: false, description: "Route through the residential proxy. Only needed for datacenter-blocked sites." },
    },
    async execute(input: any, ctx: Ctx) {
      const cfg = getConnectionConfig(ctx);
      const url = compactText(input.url);
      if (!/^https?:\/\//i.test(url)) throw new Error("url must be an absolute http(s) URL");
      const format = compactText(input.format || "text").toLowerCase();
      const maxChars = Number(input.maxChars) > 0 ? Math.min(Number(input.maxChars), 200000) : 20000;
      return withRenderedPage(
        cfg,
        { url, useProxy: input.useProxy === true, waitMs: clampWait(input.waitMs), waitSelector: input.waitSelector },
        async (page, meta) => {
          const title = await page.eval("document.title");
          const finalUrl = await page.eval("location.href");
          const robotWall = await page.eval(robotWallExpr());
          let content: string;
          if (format === "html") content = await page.eval("document.documentElement.outerHTML");
          else if (format === "links") content = JSON.stringify(await page.eval(`Array.from(document.querySelectorAll('a[href]')).slice(0,300).map(function(a){return {text:(a.innerText||'').replace(/\\s+/g,' ').trim().slice(0,80), href:a.href};})`));
          else content = await page.eval("document.body && document.body.innerText || ''");
          return {
            url,
            finalUrl,
            title,
            robotWall,
            format,
            truncated: String(content).length > maxChars,
            content: String(content).slice(0, maxChars),
            viewerUrl: meta.viewer,
            source: "steel.browser.scrape",
          };
        },
      );
    },
  });

  rl.registerAction("browser.extract", {
    description:
      "Render a URL in a Steel browser and extract structured data via a map of CSS selectors. Returns the first match (or all matches with all:true) of each selector as text.",
    inputSchema: {
      url: { type: "string", required: true, description: "Absolute URL to render." },
      selectors: { type: "object", required: true, description: "Map of { fieldName: cssSelector }." },
      all: { type: "boolean", required: false, default: false, description: "Return all matches per selector instead of the first." },
      waitMs: { type: "number", required: false, default: 9000, description: "Render wait (ms)." },
      waitSelector: { type: "string", required: false, description: "Optional CSS selector to wait for." },
      useProxy: { type: "boolean", required: false, default: false, description: "Route through the residential proxy." },
    },
    async execute(input: any, ctx: Ctx) {
      const cfg = getConnectionConfig(ctx);
      const url = compactText(input.url);
      if (!/^https?:\/\//i.test(url)) throw new Error("url must be an absolute http(s) URL");
      const selectors = input.selectors && typeof input.selectors === "object" ? input.selectors : null;
      if (!selectors || !Object.keys(selectors).length) throw new Error("selectors must be a non-empty object of { name: cssSelector }");
      const all = input.all === true;
      return withRenderedPage(
        cfg,
        { url, useProxy: input.useProxy === true, waitMs: clampWait(input.waitMs), waitSelector: input.waitSelector },
        async (page, meta) => {
          const expr = `
            (function(){
              var sels = ${JSON.stringify(selectors)};
              var all = ${all};
              function txt(el){ return el ? (el.innerText||el.textContent||'').replace(/\\s+/g,' ').trim() : null; }
              var out = {};
              for (var k in sels){
                if (all){ out[k] = Array.from(document.querySelectorAll(sels[k])).slice(0,50).map(txt); }
                else { out[k] = txt(document.querySelector(sels[k])); }
              }
              return out;
            })()`;
          return {
            url,
            finalUrl: await page.eval("location.href"),
            title: await page.eval("document.title"),
            robotWall: await page.eval(robotWallExpr()),
            data: await page.eval(expr),
            viewerUrl: meta.viewer,
            source: "steel.browser.extract",
          };
        },
      );
    },
  });

  rl.registerAction("browser.screenshot", {
    description:
      "Capture a screenshot of a URL with the Steel cloud browser and return imageUrl — a PUBLIC, login-free PNG link (https://images.steel.dev/...). To 'send a screenshot', put imageUrl in your reply: WhatsApp/Slack render it inline and anyone can open it without a Steel account. base64 is opt-in and usually pointless (the agent runtime strips large base64 from action results), so prefer imageUrl.",
    inputSchema: {
      url: { type: "string", required: true, description: "Absolute URL to capture." },
      fullPage: { type: "boolean", required: false, default: false, description: "Capture the full scrollable page." },
      waitMs: { type: "number", required: false, default: 0, description: "Milliseconds to wait before capturing (for JS-heavy pages). 0 = capture as soon as loaded." },
      useProxy: { type: "boolean", required: false, default: false, description: "Route through the BYO residential proxy (STEEL_PROXY_URL). Only for datacenter-IP-blocked surfaces." },
      includeBase64: { type: "boolean", required: false, default: false, description: "Also fetch the hosted image and return raw PNG base64. Off by default — share imageUrl instead." },
    },
    async execute(input: any, ctx: Ctx) {
      const cfg = getConnectionConfig(ctx);
      const url = compactText(input.url);
      if (!/^https?:\/\//i.test(url)) throw new Error("url must be an absolute http(s) URL");
      const steel = new SteelClient(cfg);
      const imageUrl = await steel.hostedScreenshot({
        url,
        fullPage: input.fullPage === true,
        delay: clampWait(input.waitMs, 0, 30000) || undefined,
        useProxy: input.useProxy === true,
      });
      const out: Record<string, unknown> = {
        url,
        imageUrl,
        mimeType: "image/png",
        note: "Share imageUrl — it's a public, login-free screenshot link that renders inline in chat. Put it in your reply text; don't screenshot-to-base64.",
        source: "steel.browser.screenshot",
      };
      if (input.includeBase64 === true && imageUrl) {
        try {
          const resp = await fetch(imageUrl);
          const buf = Buffer.from(await resp.arrayBuffer());
          out.byteLength = buf.length;
          out.base64 = buf.toString("base64");
        } catch (e: any) {
          out.base64Error = String(e?.message || e);
        }
      }
      return out;
    },
  });
}
