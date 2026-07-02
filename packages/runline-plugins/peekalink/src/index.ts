import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.peekalink.io";

async function apiRequest(
  apiKey: string,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${BASE}${endpoint}`, {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(`Peekalink error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function peekalink(rl: RunlinePluginAPI) {
  rl.setName("peekalink");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Peekalink API key",
      env: "PEEKALINK_API_KEY",
    },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) =>
    ctx.connection.config.apiKey as string;

  rl.registerAction("link.preview", {
    access: "read",
    description: "Get a rich preview for a URL",
    inputSchema: {
      url: { type: "string", required: true, description: "URL to preview" },
    },
    async execute(input, ctx) {
      const { url } = input as Record<string, unknown>;
      return apiRequest(key(ctx), "", { link: url });
    },
  });

  rl.registerAction("link.isAvailable", {
    access: "read",
    description: "Check whether a preview is available for a URL",
    inputSchema: {
      url: { type: "string", required: true, description: "URL to check" },
    },
    async execute(input, ctx) {
      const { url } = input as Record<string, unknown>;
      return apiRequest(key(ctx), "/is-available/", { link: url });
    },
  });
}
