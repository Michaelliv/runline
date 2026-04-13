import type { RunlinePluginAPI } from "runline";

async function apiRequest(
  url: string,
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const fullUrl = new URL(`${url}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) fullUrl.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: { "X-Gotify-Key": token, Accept: "application/json", "Content-Type": "application/json" },
  };
  if (body && Object.keys(body).length > 0 && method !== "GET" && method !== "DELETE") {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(fullUrl.toString(), opts);
  if (!res.ok) throw new Error(`Gotify API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

export default function gotify(rl: RunlinePluginAPI) {
  rl.setName("gotify");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    url: { type: "string", required: true, description: "Gotify server URL (e.g. https://gotify.example.com)", env: "GOTIFY_URL" },
    appApiToken: { type: "string", required: true, description: "Application token (for sending messages)", env: "GOTIFY_APP_TOKEN" },
    clientApiToken: { type: "string", required: true, description: "Client token (for reading/deleting)", env: "GOTIFY_CLIENT_TOKEN" },
  });

  rl.registerAction("message.create", {
    description: "Send a push message",
    inputSchema: {
      message: { type: "string", required: true, description: "Message text" },
      title: { type: "string", required: false, description: "Message title" },
      priority: { type: "number", required: false, description: "Priority (default: 1)" },
      contentType: { type: "string", required: false, description: "text/plain (default) or text/markdown" },
    },
    async execute(input, ctx) {
      const { message, title, priority, contentType } = input as Record<string, unknown>;
      const url = (ctx.connection.config.url as string).replace(/\/$/, "");
      const token = ctx.connection.config.appApiToken as string;
      const body: Record<string, unknown> = { message };
      if (title) body.title = title;
      if (priority !== undefined) body.priority = priority;
      if (contentType) body.extras = { "client::display": { contentType } };
      return apiRequest(url, token, "POST", "/message", body);
    },
  });

  rl.registerAction("message.delete", {
    description: "Delete a message",
    inputSchema: { messageId: { type: "string", required: true, description: "Message ID" } },
    async execute(input, ctx) {
      const url = (ctx.connection.config.url as string).replace(/\/$/, "");
      const token = ctx.connection.config.clientApiToken as string;
      await apiRequest(url, token, "DELETE", `/message/${(input as { messageId: string }).messageId}`);
      return { success: true };
    },
  });

  rl.registerAction("message.list", {
    description: "List messages",
    inputSchema: { limit: { type: "number", required: false, description: "Max results" } },
    async execute(input, ctx) {
      const { limit } = (input ?? {}) as { limit?: number };
      const url = (ctx.connection.config.url as string).replace(/\/$/, "");
      const token = ctx.connection.config.clientApiToken as string;
      const qs: Record<string, unknown> = {};
      if (limit) qs.limit = limit;
      const data = (await apiRequest(url, token, "GET", "/message", undefined, qs)) as Record<string, unknown>;
      return data.messages;
    },
  });
}
