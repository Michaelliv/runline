import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  return {
    url: (c.url as string).replace(/\/$/, ""),
    signature: c.signature as string,
  };
}

async function apiRequest(
  conn: { url: string; signature: string },
  qs: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${conn.url}/yourls-api.php`);
  qs.signature = conn.signature;
  qs.format = "json";
  for (const [k, v] of Object.entries(qs)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString());
  if (!res.ok)
    throw new Error(`Yourls error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (data.status === "fail") throw new Error(`Yourls error: ${data.message}`);
  return data;
}

export default function yourls(rl: RunlinePluginAPI) {
  rl.setName("yourls");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    url: {
      type: "string",
      required: true,
      description: "Yourls installation URL",
      env: "YOURLS_URL",
    },
    signature: {
      type: "string",
      required: true,
      description: "Yourls signature token",
      env: "YOURLS_SIGNATURE",
    },
  });

  rl.registerAction("url.shorten", {
    access: "write",
    description: "Shorten a URL",
    inputSchema: {
      url: { type: "string", required: true },
      keyword: {
        type: "string",
        required: false,
        description: "Custom short URL keyword",
      },
      title: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { action: "shorturl", url: p.url };
      if (p.keyword) qs.keyword = p.keyword;
      if (p.title) qs.title = p.title;
      return apiRequest(getConn(ctx), qs);
    },
  });

  rl.registerAction("url.expand", {
    access: "read",
    description: "Expand a short URL to its original",
    inputSchema: { shortUrl: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(getConn(ctx), {
        action: "expand",
        shorturl: (input as Record<string, unknown>).shortUrl,
      });
    },
  });

  rl.registerAction("url.stats", {
    access: "read",
    description: "Get stats for a short URL",
    inputSchema: { shortUrl: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await apiRequest(getConn(ctx), {
        action: "url-stats",
        shorturl: (input as Record<string, unknown>).shortUrl,
      })) as Record<string, unknown>;
      return data.link;
    },
  });
}
