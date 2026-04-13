import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  const base = ((c.url as string) || "https://app.monicahq.com").replace(/\/$/, "");
  return { url: base, token: c.apiToken as string };
}

async function api(conn: ReturnType<typeof getConn>, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`${conn.url}/api${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${conn.token}`, "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`Monica CRM error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

function registerCrud(rl: RunlinePluginAPI, resource: string, plural: string, conn: typeof getConn,
  createSchema: Record<string, { type: string; required: boolean; description?: string }>) {

  rl.registerAction(`${resource}.create`, { description: `Create a ${resource}`, inputSchema: createSchema,
    async execute(input, ctx) { const data = (await api(conn(ctx), "POST", `/${plural}`, input as Record<string, unknown>)) as Record<string, unknown>; return data.data; } });

  rl.registerAction(`${resource}.get`, { description: `Get a ${resource}`, inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const data = (await api(conn(ctx), "GET", `/${plural}/${(input as Record<string, unknown>).id}`)) as Record<string, unknown>; return data.data; } });

  rl.registerAction(`${resource}.list`, { description: `List ${plural}`, inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) { const qs: Record<string, unknown> = { limit: ((input ?? {}) as Record<string, unknown>).limit ?? 100 }; const data = (await api(conn(ctx), "GET", `/${plural}`, undefined, qs)) as Record<string, unknown>; return data.data; } });

  rl.registerAction(`${resource}.update`, { description: `Update a ${resource}`, inputSchema: { id: { type: "string", required: true }, data: { type: "object", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; const data = (await api(conn(ctx), "PUT", `/${plural}/${p.id}`, p.data as Record<string, unknown>)) as Record<string, unknown>; return data.data; } });

  rl.registerAction(`${resource}.delete`, { description: `Delete a ${resource}`, inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { await api(conn(ctx), "DELETE", `/${plural}/${(input as Record<string, unknown>).id}`); return { success: true }; } });
}

export default function monicaCrm(rl: RunlinePluginAPI) {
  rl.setName("monicaCrm");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    apiToken: { type: "string", required: true, description: "Monica API token", env: "MONICA_API_TOKEN" },
    url: { type: "string", required: false, description: "Monica URL (default: https://app.monicahq.com)", env: "MONICA_URL" },
  });

  registerCrud(rl, "contact", "contacts", getConn, { first_name: { type: "string", required: true }, last_name: { type: "string", required: false }, gender_id: { type: "number", required: false } });
  registerCrud(rl, "activity", "activities", getConn, { summary: { type: "string", required: true }, description: { type: "string", required: false }, activity_type_id: { type: "number", required: false } });
  registerCrud(rl, "note", "notes", getConn, { contact_id: { type: "number", required: true }, body: { type: "string", required: true } });
  registerCrud(rl, "task", "tasks", getConn, { title: { type: "string", required: true }, contact_id: { type: "number", required: false } });
  registerCrud(rl, "tag", "tags", getConn, { name: { type: "string", required: true } });
  registerCrud(rl, "journalEntry", "journal", getConn, { title: { type: "string", required: true }, post: { type: "string", required: true } });
  registerCrud(rl, "reminder", "reminders", getConn, { contact_id: { type: "number", required: true }, title: { type: "string", required: true }, initial_date: { type: "string", required: true }, frequency_type: { type: "string", required: true, description: "one_time, week, month, year" } });
  registerCrud(rl, "call", "calls", getConn, { contact_id: { type: "number", required: true }, content: { type: "string", required: false }, called_at: { type: "string", required: false } });
  registerCrud(rl, "conversation", "conversations", getConn, { contact_id: { type: "number", required: true }, contact_field_type_id: { type: "number", required: true }, happened_at: { type: "string", required: true } });
}
