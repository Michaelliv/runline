import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  return { url: (c.url as string).replace(/\/$/, ""), apiKey: c.apiKey as string };
}

async function api(conn: ReturnType<typeof getConn>, method: string, endpoint: string, body?: Record<string, unknown>, qs?: Record<string, unknown>): Promise<unknown> {
  const url = new URL(`${conn.url}/api${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${conn.apiKey}`, "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`TheHive error ${res.status}: ${await res.text()}`);
  return res.json();
}

export default function thehive(rl: RunlinePluginAPI) {
  rl.setName("thehive");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    url: { type: "string", required: true, description: "TheHive instance URL", env: "THEHIVE_URL" },
    apiKey: { type: "string", required: true, description: "TheHive API key", env: "THEHIVE_API_KEY" },
  });

  // ── Alert ───────────────────────────────────────────

  rl.registerAction("alert.create", { description: "Create an alert",
    inputSchema: { title: { type: "string", required: true }, description: { type: "string", required: true }, severity: { type: "number", required: true, description: "1-4" }, type: { type: "string", required: true }, source: { type: "string", required: true }, sourceRef: { type: "string", required: true }, tlp: { type: "number", required: false }, tags: { type: "string", required: false, description: "Comma-separated" } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { ...p, date: Date.now() };
      if (p.tags) body.tags = (p.tags as string).split(",").map(t => t.trim());
      return api(getConn(ctx), "POST", "/alert", body);
    } });

  rl.registerAction("alert.get", { description: "Get an alert by ID", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return api(getConn(ctx), "GET", `/alert/${(input as Record<string, unknown>).id}`); } });

  rl.registerAction("alert.list", { description: "List alerts", inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body = { query: [{ _name: "listAlert" }] } as Record<string, unknown>;
      if (p.limit) (body.query as unknown[]).push({ _name: "page", from: 0, to: p.limit });
      return api(getConn(ctx), "POST", "/v1/query", body, { name: "alerts" });
    } });

  rl.registerAction("alert.update", { description: "Update an alert", inputSchema: { id: { type: "string", required: true }, data: { type: "object", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; return api(getConn(ctx), "PATCH", `/alert/${p.id}`, p.data as Record<string, unknown>); } });

  rl.registerAction("alert.markAsRead", { description: "Mark an alert as read", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return api(getConn(ctx), "POST", `/alert/${(input as Record<string, unknown>).id}/markAsRead`); } });

  rl.registerAction("alert.markAsUnread", { description: "Mark an alert as unread", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return api(getConn(ctx), "POST", `/alert/${(input as Record<string, unknown>).id}/markAsUnread`); } });

  rl.registerAction("alert.promote", { description: "Promote an alert to a case", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return api(getConn(ctx), "POST", `/alert/${(input as Record<string, unknown>).id}/createCase`); } });

  rl.registerAction("alert.merge", { description: "Merge an alert into an existing case", inputSchema: { alertId: { type: "string", required: true }, caseId: { type: "string", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; return api(getConn(ctx), "POST", `/alert/${p.alertId}/merge/${p.caseId}`); } });

  // ── Case ────────────────────────────────────────────

  rl.registerAction("case.create", { description: "Create a case",
    inputSchema: { title: { type: "string", required: true }, description: { type: "string", required: true }, severity: { type: "number", required: true }, tlp: { type: "number", required: false }, tags: { type: "string", required: false, description: "Comma-separated" }, owner: { type: "string", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { ...p, startDate: Date.now() };
      if (p.tags) body.tags = (p.tags as string).split(",").map(t => t.trim());
      return api(getConn(ctx), "POST", "/case", body);
    } });

  rl.registerAction("case.get", { description: "Get a case", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { return api(getConn(ctx), "GET", `/case/${(input as Record<string, unknown>).id}`); } });

  rl.registerAction("case.list", { description: "List cases", inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body = { query: [{ _name: "listCase" }] } as Record<string, unknown>;
      if (p.limit) (body.query as unknown[]).push({ _name: "page", from: 0, to: p.limit });
      return api(getConn(ctx), "POST", "/v1/query", body, { name: "cases" });
    } });

  rl.registerAction("case.update", { description: "Update a case", inputSchema: { id: { type: "string", required: true }, data: { type: "object", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; return api(getConn(ctx), "PATCH", `/case/${p.id}`, p.data as Record<string, unknown>); } });

  // ── Observable ──────────────────────────────────────

  rl.registerAction("observable.create", { description: "Create an observable on a case",
    inputSchema: { caseId: { type: "string", required: true }, dataType: { type: "string", required: true }, data: { type: "string", required: true }, message: { type: "string", required: false }, tlp: { type: "number", required: false }, ioc: { type: "boolean", required: false }, sighted: { type: "boolean", required: false } },
    async execute(input, ctx) {
      const { caseId, ...body } = input as Record<string, unknown>;
      return api(getConn(ctx), "POST", `/case/${caseId}/artifact`, body);
    } });

  rl.registerAction("observable.get", { description: "Get an observable", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(getConn(ctx), "POST", "/v1/query", { query: [{ _name: "getObservable", idOrName: (input as Record<string, unknown>).id }] }, { name: "get-observable" });
    } });

  rl.registerAction("observable.list", { description: "List observables for a case", inputSchema: { caseId: { type: "string", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body = { query: [{ _name: "getCase", idOrName: p.caseId }, { _name: "observables" }] } as Record<string, unknown>;
      if (p.limit) (body.query as unknown[]).push({ _name: "page", from: 0, to: p.limit });
      return api(getConn(ctx), "POST", "/v1/query", body, { name: "observables" });
    } });

  rl.registerAction("observable.update", { description: "Update an observable", inputSchema: { id: { type: "string", required: true }, data: { type: "object", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; return api(getConn(ctx), "PATCH", `/case/artifact/${p.id}`, p.data as Record<string, unknown>); } });

  // ── Task ────────────────────────────────────────────

  rl.registerAction("task.create", { description: "Create a task on a case",
    inputSchema: { caseId: { type: "string", required: true }, title: { type: "string", required: true }, status: { type: "string", required: false, description: "Waiting, InProgress, Completed, Cancel" }, flag: { type: "boolean", required: false } },
    async execute(input, ctx) {
      const { caseId, ...body } = input as Record<string, unknown>;
      return api(getConn(ctx), "POST", `/case/${caseId}/task`, body);
    } });

  rl.registerAction("task.get", { description: "Get a task", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(getConn(ctx), "POST", "/v1/query", { query: [{ _name: "getTask", idOrName: (input as Record<string, unknown>).id }] }, { name: "get-task" });
    } });

  rl.registerAction("task.list", { description: "List tasks for a case", inputSchema: { caseId: { type: "string", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body = { query: [{ _name: "getCase", idOrName: p.caseId }, { _name: "tasks" }] } as Record<string, unknown>;
      if (p.limit) (body.query as unknown[]).push({ _name: "page", from: 0, to: p.limit });
      return api(getConn(ctx), "POST", "/v1/query", body, { name: "case-tasks" });
    } });

  rl.registerAction("task.update", { description: "Update a task", inputSchema: { id: { type: "string", required: true }, data: { type: "object", required: true } },
    async execute(input, ctx) { const p = input as Record<string, unknown>; return api(getConn(ctx), "PATCH", `/case/task/${p.id}`, p.data as Record<string, unknown>); } });

  // ── Log ─────────────────────────────────────────────

  rl.registerAction("log.create", { description: "Create a log entry on a task",
    inputSchema: { taskId: { type: "string", required: true }, message: { type: "string", required: true }, status: { type: "string", required: false, description: "Ok, Deleted" } },
    async execute(input, ctx) {
      const { taskId, ...body } = input as Record<string, unknown>;
      (body as Record<string, unknown>).startDate = Date.now();
      return api(getConn(ctx), "POST", `/case/task/${taskId}/log`, body);
    } });

  rl.registerAction("log.get", { description: "Get a log entry", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(getConn(ctx), "POST", "/v1/query", { query: [{ _name: "getLog", idOrName: (input as Record<string, unknown>).id }] }, { name: "get-log" });
    } });

  rl.registerAction("log.list", { description: "List logs for a task", inputSchema: { taskId: { type: "string", required: true }, limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body = { query: [{ _name: "getTask", idOrName: p.taskId }, { _name: "logs" }] } as Record<string, unknown>;
      if (p.limit) (body.query as unknown[]).push({ _name: "page", from: 0, to: p.limit });
      return api(getConn(ctx), "POST", "/v1/query", body, { name: "case-task-logs" });
    } });
}
