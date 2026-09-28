import type { ActionContext, RunlinePluginAPI } from "runline";
import { answerFailed, credentialJson } from "../../_shared/credentials.js";
import { yourlsCredential } from "./credentials.js";

async function apiRequest(
  ctx: ActionContext,
  qs: Record<string, unknown>,
): Promise<unknown> {
  const data = (await credentialJson(ctx, yourlsCredential, "yourls", {
    target: "api",
    path: "yourls-api.php",
    query: { ...qs, format: "json" },
  })) as Record<string, unknown>;
  if (data.status === "fail") throw answerFailed("yourls", data.code);
  return data;
}

export default function yourls(rl: RunlinePluginAPI) {
  rl.setName("yourls");
  rl.setVersion("0.1.0");
  rl.setCredential(yourlsCredential);
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
      return apiRequest(ctx, qs);
    },
  });

  rl.registerAction("url.expand", {
    access: "read",
    description: "Expand a short URL to its original",
    inputSchema: { shortUrl: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(ctx, {
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
      const data = (await apiRequest(ctx, {
        action: "url-stats",
        shorturl: (input as Record<string, unknown>).shortUrl,
      })) as Record<string, unknown>;
      return data.link;
    },
  });
}
