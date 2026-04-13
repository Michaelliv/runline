import type { RunlinePluginAPI } from "runline";

const BASE = "https://onesimpleapi.com/api";

async function apiRequest(
  token: string,
  endpoint: string,
  qs: Record<string, unknown> = {},
): Promise<unknown> {
  const url = new URL(`${BASE}${endpoint}`);
  url.searchParams.set("token", token);
  url.searchParams.set("output", "json");
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`OneSimpleAPI error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function oneSimpleApi(rl: RunlinePluginAPI) {
  rl.setName("oneSimpleApi");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiToken: { type: "string", required: true, description: "OneSimpleAPI token", env: "ONE_SIMPLE_API_TOKEN" },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.apiToken as string;

  // ── Website ─────────────────────────────────────────

  rl.registerAction("website.pdf", {
    description: "Generate a PDF from a webpage (returns URL to the PDF)",
    inputSchema: {
      url: { type: "string", required: true, description: "Webpage URL" },
      page: { type: "string", required: false, description: "Page size: A0-A6, Letter, Legal, Tabloid, Ledger" },
      force: { type: "boolean", required: false, description: "Force refresh (default false)" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { url: p.url };
      if (p.page) qs.page = p.page;
      qs.force = p.force ? "yes" : "no";
      return apiRequest(key(ctx), "/pdf", qs);
    },
  });

  rl.registerAction("website.screenshot", {
    description: "Take a screenshot of a webpage (returns URL to the image)",
    inputSchema: {
      url: { type: "string", required: true, description: "Webpage URL" },
      screen: { type: "string", required: false, description: "Screen size: phone, phone-landscape, tablet, tablet-landscape, retina" },
      fullpage: { type: "boolean", required: false, description: "Capture full page (default false)" },
      force: { type: "boolean", required: false, description: "Force refresh (default false)" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { url: p.url };
      if (p.screen) qs.screen = p.screen;
      qs.fullpage = p.fullpage ? "yes" : "no";
      qs.force = p.force ? "yes" : "no";
      return apiRequest(key(ctx), "/screenshot", qs);
    },
  });

  rl.registerAction("website.seo", {
    description: "Get SEO information from a webpage",
    inputSchema: {
      url: { type: "string", required: true, description: "Webpage URL" },
      headers: { type: "boolean", required: false, description: "Include response headers (default false)" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { url: p.url };
      if (p.headers) qs.headers = "yes";
      return apiRequest(key(ctx), "/page_info", qs);
    },
  });

  // ── Social Profile ──────────────────────────────────

  rl.registerAction("socialProfile.instagram", {
    description: "Get details about an Instagram profile",
    inputSchema: {
      profile: { type: "string", required: true, description: "Instagram profile name" },
    },
    async execute(input, ctx) {
      const { profile } = input as Record<string, unknown>;
      return apiRequest(key(ctx), "/instagram_profile", { profile });
    },
  });

  rl.registerAction("socialProfile.spotify", {
    description: "Get details about a Spotify artist",
    inputSchema: {
      profile: { type: "string", required: true, description: "Spotify artist name" },
    },
    async execute(input, ctx) {
      const { profile } = input as Record<string, unknown>;
      return apiRequest(key(ctx), "/spotify_profile", { profile });
    },
  });

  // ── Information ─────────────────────────────────────

  rl.registerAction("information.exchangeRate", {
    description: "Convert a value between currencies",
    inputSchema: {
      value: { type: "string", required: true, description: "Value to convert" },
      fromCurrency: { type: "string", required: true, description: "Source currency (e.g. USD)" },
      toCurrency: { type: "string", required: true, description: "Target currency (e.g. EUR)" },
    },
    async execute(input, ctx) {
      const { value, fromCurrency, toCurrency } = input as Record<string, unknown>;
      return apiRequest(key(ctx), "/exchange_rate", {
        from_value: value, from_currency: fromCurrency, to_currency: toCurrency,
      });
    },
  });

  rl.registerAction("information.imageMetadata", {
    description: "Get metadata from an image URL",
    inputSchema: {
      url: { type: "string", required: true, description: "Image URL" },
    },
    async execute(input, ctx) {
      const { url } = input as Record<string, unknown>;
      return apiRequest(key(ctx), "/image_info", { url, raw: true });
    },
  });

  // ── Utility ─────────────────────────────────────────

  rl.registerAction("utility.validateEmail", {
    description: "Validate an email address",
    inputSchema: {
      email: { type: "string", required: true, description: "Email address to validate" },
    },
    async execute(input, ctx) {
      const { email } = input as Record<string, unknown>;
      return apiRequest(key(ctx), "/email", { email });
    },
  });

  rl.registerAction("utility.expandUrl", {
    description: "Expand a shortened URL",
    inputSchema: {
      url: { type: "string", required: true, description: "Shortened URL" },
    },
    async execute(input, ctx) {
      const { url } = input as Record<string, unknown>;
      return apiRequest(key(ctx), "/unshorten", { url });
    },
  });

  rl.registerAction("utility.qrCode", {
    description: "Generate a QR code (returns URL to the image)",
    inputSchema: {
      message: { type: "string", required: true, description: "Content for the QR code (URL, text, etc.)" },
      size: { type: "string", required: false, description: "Size: Small, Medium, Large" },
      format: { type: "string", required: false, description: "Format: PNG or SVG" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { message: p.message };
      if (p.size) qs.size = p.size;
      if (p.format) qs.format = p.format;
      return apiRequest(key(ctx), "/qr_code", qs);
    },
  });
}
