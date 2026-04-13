import type { RunlinePluginAPI } from "runline";

const BASE = "https://api.uptimerobot.com/v2";

async function apiRequest(apiKey: string, endpoint: string, body: Record<string, unknown> = {}): Promise<unknown> {
  const form = new URLSearchParams();
  form.set("api_key", apiKey);
  for (const [k, v] of Object.entries(body)) { if (v !== undefined && v !== null) form.set(k, String(v)); }
  const res = await fetch(`${BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!res.ok) throw new Error(`UptimeRobot error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (data.stat !== "ok") throw new Error(`UptimeRobot error: ${JSON.stringify(data)}`);
  return data;
}

export default function uptimerobot(rl: RunlinePluginAPI) {
  rl.setName("uptimerobot");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({ apiKey: { type: "string", required: true, description: "UptimeRobot API key", env: "UPTIMEROBOT_API_KEY" } });
  const key = (ctx: { connection: { config: Record<string, unknown> } }) => ctx.connection.config.apiKey as string;

  // ── Account ─────────────────────────────────────────

  rl.registerAction("account.get", {
    description: "Get account details",
    inputSchema: {},
    async execute(_input, ctx) {
      const data = (await apiRequest(key(ctx), "/getAccountDetails")) as Record<string, unknown>;
      return data.account;
    },
  });

  // ── Monitor ─────────────────────────────────────────

  rl.registerAction("monitor.create", {
    description: "Create a monitor",
    inputSchema: {
      friendlyName: { type: "string", required: true },
      url: { type: "string", required: true },
      type: { type: "number", required: true, description: "1=HTTP(s), 2=Keyword, 3=Ping, 4=Port, 5=Heartbeat" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await apiRequest(key(ctx), "/newMonitor", { friendly_name: p.friendlyName, url: p.url, type: p.type })) as Record<string, unknown>;
      return data.monitor;
    },
  });

  rl.registerAction("monitor.get", {
    description: "Get a monitor by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await apiRequest(key(ctx), "/getMonitors", { monitors: (input as Record<string, unknown>).id })) as Record<string, unknown>;
      return data.monitors;
    },
  });

  rl.registerAction("monitor.list", {
    description: "List monitors",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (p.limit) body.limit = p.limit;
      const data = (await apiRequest(key(ctx), "/getMonitors", body)) as Record<string, unknown>;
      return data.monitors;
    },
  });

  rl.registerAction("monitor.update", {
    description: "Update a monitor",
    inputSchema: { id: { type: "string", required: true }, friendlyName: { type: "string", required: false }, url: { type: "string", required: false }, type: { type: "number", required: false } },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { id };
      if (fields.friendlyName) body.friendly_name = fields.friendlyName;
      if (fields.url) body.url = fields.url;
      if (fields.type) body.type = fields.type;
      const data = (await apiRequest(key(ctx), "/editMonitor", body)) as Record<string, unknown>;
      return data.monitor;
    },
  });

  rl.registerAction("monitor.delete", {
    description: "Delete a monitor",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await apiRequest(key(ctx), "/deleteMonitor", { id: (input as Record<string, unknown>).id })) as Record<string, unknown>;
      return data.monitor;
    },
  });

  rl.registerAction("monitor.reset", {
    description: "Reset a monitor's stats",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await apiRequest(key(ctx), "/resetMonitor", { id: (input as Record<string, unknown>).id })) as Record<string, unknown>;
      return data.monitor;
    },
  });

  // ── Alert Contact ───────────────────────────────────

  rl.registerAction("alertContact.create", {
    description: "Create an alert contact",
    inputSchema: { friendlyName: { type: "string", required: true }, value: { type: "string", required: true, description: "Email or phone" }, type: { type: "number", required: true, description: "1=SMS, 2=Email, 3=Twitter, 5=Pushbullet, 11=Slack" } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await apiRequest(key(ctx), "/newAlertContact", { friendly_name: p.friendlyName, value: p.value, type: p.type })) as Record<string, unknown>;
      return data.alertcontact;
    },
  });

  rl.registerAction("alertContact.get", {
    description: "Get an alert contact by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await apiRequest(key(ctx), "/getAlertContacts", { alert_contacts: (input as Record<string, unknown>).id })) as Record<string, unknown>;
      return data.alert_contacts;
    },
  });

  rl.registerAction("alertContact.list", {
    description: "List alert contacts",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const body: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit) body.limit = (input as Record<string, unknown>).limit;
      const data = (await apiRequest(key(ctx), "/getAlertContacts", body)) as Record<string, unknown>;
      return data.alert_contacts;
    },
  });

  rl.registerAction("alertContact.update", {
    description: "Update an alert contact",
    inputSchema: { id: { type: "string", required: true }, friendlyName: { type: "string", required: false }, value: { type: "string", required: false } },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { id };
      if (fields.friendlyName) body.friendly_name = fields.friendlyName;
      if (fields.value) body.value = fields.value;
      const data = (await apiRequest(key(ctx), "/editAlertContact", body)) as Record<string, unknown>;
      return data.alert_contact;
    },
  });

  rl.registerAction("alertContact.delete", {
    description: "Delete an alert contact",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await apiRequest(key(ctx), "/deleteAlertContact", { id: (input as Record<string, unknown>).id })) as Record<string, unknown>;
      return data.alert_contact;
    },
  });

  // ── Maintenance Window ──────────────────────────────

  rl.registerAction("maintenanceWindow.create", {
    description: "Create a maintenance window",
    inputSchema: {
      friendlyName: { type: "string", required: true },
      type: { type: "number", required: true, description: "1=Once, 2=Daily, 3=Weekly, 4=Monthly" },
      startTime: { type: "string", required: true, description: "ISO datetime for once, HH:mm for recurring" },
      duration: { type: "number", required: true, description: "Duration in minutes" },
      value: { type: "number", required: false, description: "Day of week (1-7) or month (1-28) for weekly/monthly" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { friendly_name: p.friendlyName, type: p.type, start_time: p.startTime, duration: p.duration };
      if (p.value) body.value = p.value;
      const data = (await apiRequest(key(ctx), "/newMWindow", body)) as Record<string, unknown>;
      return data.mwindow;
    },
  });

  rl.registerAction("maintenanceWindow.get", {
    description: "Get a maintenance window",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await apiRequest(key(ctx), "/getMWindows", { mwindows: (input as Record<string, unknown>).id })) as Record<string, unknown>;
      return data.mwindows;
    },
  });

  rl.registerAction("maintenanceWindow.list", {
    description: "List maintenance windows",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const body: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit) body.limit = (input as Record<string, unknown>).limit;
      const data = (await apiRequest(key(ctx), "/getMWindows", body)) as Record<string, unknown>;
      return data.mwindows;
    },
  });

  rl.registerAction("maintenanceWindow.update", {
    description: "Update a maintenance window",
    inputSchema: { id: { type: "string", required: true }, friendlyName: { type: "string", required: false }, duration: { type: "number", required: false }, startTime: { type: "string", required: false } },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { id };
      if (fields.friendlyName) body.friendly_name = fields.friendlyName;
      if (fields.duration) body.duration = fields.duration;
      if (fields.startTime) body.start_time = fields.startTime;
      const data = (await apiRequest(key(ctx), "/editMWindow", body)) as Record<string, unknown>;
      return data.mwindow;
    },
  });

  rl.registerAction("maintenanceWindow.delete", {
    description: "Delete a maintenance window",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return apiRequest(key(ctx), "/deleteMWindow", { id: (input as Record<string, unknown>).id });
    },
  });

  // ── Public Status Page ──────────────────────────────

  rl.registerAction("publicStatusPage.create", {
    description: "Create a public status page",
    inputSchema: { friendlyName: { type: "string", required: true }, monitors: { type: "string", required: true, description: "Monitor IDs (comma-separated or 0 for all)" } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await apiRequest(key(ctx), "/newPSP", { friendly_name: p.friendlyName, monitors: p.monitors })) as Record<string, unknown>;
      return data.psp;
    },
  });

  rl.registerAction("publicStatusPage.get", {
    description: "Get a public status page",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await apiRequest(key(ctx), "/getPSPs", { psps: (input as Record<string, unknown>).id })) as Record<string, unknown>;
      return data.psps;
    },
  });

  rl.registerAction("publicStatusPage.list", {
    description: "List public status pages",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const body: Record<string, unknown> = {};
      if ((input as Record<string, unknown>)?.limit) body.limit = (input as Record<string, unknown>).limit;
      const data = (await apiRequest(key(ctx), "/getPSPs", body)) as Record<string, unknown>;
      return data.psps;
    },
  });

  rl.registerAction("publicStatusPage.update", {
    description: "Update a public status page",
    inputSchema: { id: { type: "string", required: true }, friendlyName: { type: "string", required: false }, monitors: { type: "string", required: false } },
    async execute(input, ctx) {
      const { id, ...fields } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { id };
      if (fields.friendlyName) body.friendly_name = fields.friendlyName;
      if (fields.monitors) body.monitors = fields.monitors;
      const data = (await apiRequest(key(ctx), "/editPSP", body)) as Record<string, unknown>;
      return data.psp;
    },
  });

  rl.registerAction("publicStatusPage.delete", {
    description: "Delete a public status page",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await apiRequest(key(ctx), "/deletePSP", { id: (input as Record<string, unknown>).id })) as Record<string, unknown>;
      return data.psp;
    },
  });
}
