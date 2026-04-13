import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.getvero.com/api/v2";

async function apiRequest(token: string, method: string, endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const form = new URLSearchParams();
  form.set("auth_token", token);
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null) form.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const res = await fetch(`${BASE}${endpoint}`, { method, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  if (!res.ok) throw new Error(`Vero error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function vero(rl: RunlinePluginAPI) {
  rl.setName("vero");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({ authToken: { type: "string", required: true, description: "Vero auth token", env: "VERO_AUTH_TOKEN" } });
  const key = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.authToken as string;

  rl.registerAction("user.create", {
    description: "Create/identify a user",
    inputSchema: { id: { type: "string", required: true }, email: { type: "string", required: false }, data: { type: "object", required: false, description: "Custom attributes" } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { id: p.id };
      if (p.email) body.email = p.email;
      if (p.data) body.data = p.data;
      return apiRequest(key(ctx), "POST", "/users/track", body);
    },
  });

  rl.registerAction("user.alias", {
    description: "Alias (re-identify) a user",
    inputSchema: { id: { type: "string", required: true }, newId: { type: "string", required: true } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(key(ctx), "PUT", "/users/reidentify", { id: p.id, new_id: p.newId });
    },
  });

  for (const op of ["unsubscribe", "resubscribe", "delete"] as const) {
    rl.registerAction(`user.${op}`, {
      description: `${op.charAt(0).toUpperCase() + op.slice(1)} a user`,
      inputSchema: { id: { type: "string", required: true } },
      async execute(input, ctx) { return apiRequest(key(ctx), "POST", `/users/${op}`, { id: (input as Record<string, unknown>).id }); },
    });
  }

  rl.registerAction("user.addTags", {
    description: "Add tags to a user",
    inputSchema: { id: { type: "string", required: true }, tags: { type: "string", required: true, description: "Comma-separated tags" } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(key(ctx), "PUT", "/users/tags/edit", { id: p.id, add: JSON.stringify((p.tags as string).split(",").map(t => t.trim())) });
    },
  });

  rl.registerAction("user.removeTags", {
    description: "Remove tags from a user",
    inputSchema: { id: { type: "string", required: true }, tags: { type: "string", required: true, description: "Comma-separated tags" } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(key(ctx), "PUT", "/users/tags/edit", { id: p.id, remove: JSON.stringify((p.tags as string).split(",").map(t => t.trim())) });
    },
  });

  rl.registerAction("event.track", {
    description: "Track an event",
    inputSchema: {
      id: { type: "string", required: true }, email: { type: "string", required: true },
      eventName: { type: "string", required: true }, data: { type: "object", required: false },
      extras: { type: "object", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { identity: { id: p.id, email: p.email }, event_name: p.eventName, email: p.email };
      if (p.data) body.data = JSON.stringify(p.data);
      if (p.extras) body.extras = JSON.stringify(p.extras);
      return apiRequest(key(ctx), "POST", "/events/track", body);
    },
  });
}
