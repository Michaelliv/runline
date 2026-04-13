import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.pushbullet.com/v2";

async function apiRequest(
  token: string, method: string, path: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${BASE}${path}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { "Access-Token": token, "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`Pushbullet error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function paginate(token: string, path: string, qs: Record<string, unknown> = {}): Promise<unknown[]> {
  const all: unknown[] = [];
  let cursor: string | undefined;
  do {
    if (cursor) qs.cursor = cursor;
    const data = (await apiRequest(token, "GET", path, undefined, qs)) as Record<string, unknown>;
    const items = (data.pushes ?? []) as unknown[];
    all.push(...items);
    cursor = data.cursor as string | undefined;
  } while (cursor);
  return all;
}

export default function pushbullet(rl: RunlinePluginAPI) {
  rl.setName("pushbullet");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    accessToken: { type: "string", required: true, description: "Pushbullet Access Token", env: "PUSHBULLET_ACCESS_TOKEN" },
  });

  const key = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.accessToken as string;

  rl.registerAction("push.create", {
    description: "Create a push (note or link)",
    inputSchema: {
      type: { type: "string", required: true, description: "note or link" },
      title: { type: "string", required: true },
      body: { type: "string", required: true },
      url: { type: "string", required: false, description: "URL (required for link type)" },
      target: { type: "string", required: false, description: "Target: default, device_iden, email, channel_tag" },
      targetValue: { type: "string", required: false, description: "Value for target (device ID, email, or channel tag)" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const reqBody: Record<string, unknown> = { type: p.type, title: p.title, body: p.body };
      if (p.type === "link" && p.url) reqBody.url = p.url;
      const target = (p.target as string) ?? "default";
      if (target !== "default" && p.targetValue) reqBody[target] = p.targetValue;
      return apiRequest(key(ctx), "POST", "/pushes", reqBody);
    },
  });

  rl.registerAction("push.list", {
    description: "List pushes",
    inputSchema: {
      limit: { type: "number", required: false },
      active: { type: "boolean", required: false, description: "Only return non-deleted pushes" },
      modifiedAfter: { type: "string", required: false, description: "ISO timestamp — only return pushes modified after this" },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.active) qs.active = "true";
      if (p.modifiedAfter) qs.modified_after = String(Math.floor(new Date(p.modifiedAfter as string).getTime() / 1000));
      if (p.limit) { qs.limit = p.limit; const d = (await apiRequest(key(ctx), "GET", "/pushes", undefined, qs)) as Record<string, unknown>; return d.pushes; }
      return paginate(key(ctx), "/pushes", qs);
    },
  });

  rl.registerAction("push.delete", {
    description: "Delete a push",
    inputSchema: { pushId: { type: "string", required: true } },
    async execute(input, ctx) {
      const { pushId } = input as Record<string, unknown>;
      await apiRequest(key(ctx), "DELETE", `/pushes/${pushId}`);
      return { success: true };
    },
  });

  rl.registerAction("push.update", {
    description: "Update a push (dismiss it)",
    inputSchema: {
      pushId: { type: "string", required: true },
      dismissed: { type: "boolean", required: true, description: "Mark push as dismissed" },
    },
    async execute(input, ctx) {
      const { pushId, dismissed } = input as Record<string, unknown>;
      return apiRequest(key(ctx), "POST", `/pushes/${pushId}`, { dismissed });
    },
  });
}
