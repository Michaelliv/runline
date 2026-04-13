import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const url = (ctx.connection.config.url as string).replace(/\/$/, "");
  const apiKey = ctx.connection.config.apiKey as string;
  return { url, apiKey };
}

async function api(url: string, apiKey: string, method: string, path: string, body?: Record<string, unknown>, qs?: Record<string, unknown>): Promise<unknown> {
  const u = new URL(`${url}/api${path}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined) u.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(u.toString(), init);
  if (res.status === 204) return { success: true };
  if (!res.ok) throw new Error(`TheHive error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : { success: true };
}

// TheHive v1 query API — paginated search
async function query(url: string, apiKey: string, scope: { query: string; id?: string; restrictTo?: string }, filters?: Record<string, unknown>[], sortFields?: Record<string, unknown>[], limit?: number): Promise<unknown> {
  const q: Record<string, unknown>[] = [];
  if (scope.id) q.push({ _name: scope.query, idOrName: scope.id }); else q.push({ _name: scope.query });
  if (scope.restrictTo) q.push({ _name: scope.restrictTo });
  if (filters && filters.length) q.push({ _name: "filter", _and: filters });
  if (sortFields && sortFields.length) q.push({ _name: "sort", _fields: sortFields });
  if (limit) { q.push({ _name: "page", from: 0, to: limit }); return api(url, apiKey, "POST", "/v1/query", { query: q }); }
  // Paginate in batches of 500
  const results: unknown[] = [];
  let from = 0;
  let batch: unknown[];
  do {
    batch = (await api(url, apiKey, "POST", "/v1/query", { query: [...q, { _name: "page", from, to: from + 500 }] }) ?? []) as unknown[];
    results.push(...batch);
    from += 500;
  } while (batch.length > 0);
  return results;
}

type Scope = { query: string; id?: string; restrictTo?: string };

function searchAction(rl: RunlinePluginAPI, name: string, scope: Scope | string, description: string, extraInputs?: Record<string, unknown>) {
  rl.registerAction(name, { description,
    inputSchema: { limit: { type: "number", required: false }, filters: { type: "object", required: false, description: "Array of filter objects" }, sort: { type: "object", required: false, description: "Array of sort field objects" }, ...extraInputs },
    async execute(input, ctx) {
      const { url, apiKey } = getConn(ctx);
      const p = (input ?? {}) as Record<string, unknown>;
      let s: Scope;
      if (typeof scope === "string") { s = { query: scope }; } else { s = scope; }
      // If there's scope customization via input (e.g. caseId for tasks)
      if (p.caseId && typeof scope === "object" && scope.restrictTo) { s = { query: "getCase", id: p.caseId as string, restrictTo: scope.restrictTo }; }
      return query(url, apiKey, s, p.filters as Record<string, unknown>[] | undefined, p.sort as Record<string, unknown>[] | undefined, p.limit as number | undefined);
    } });
}

export default function theHiveProject(rl: RunlinePluginAPI) {
  rl.setName("thehiveProject");
  rl.setVersion("0.1.0");
  rl.setConnectionSchema({
    url: { type: "string", required: true, description: "TheHive instance URL", env: "THEHIVE_URL" },
    apiKey: { type: "string", required: true, description: "API key", env: "THEHIVE_API_KEY" },
  });

  // ── Alert ───────────────────────────────────────────

  rl.registerAction("alert.create", { description: "Create an alert",
    inputSchema: { type: { type: "string", required: true }, source: { type: "string", required: true }, sourceRef: { type: "string", required: true }, title: { type: "string", required: true }, description: { type: "string", required: false }, severity: { type: "number", required: false }, tlp: { type: "number", required: false }, tags: { type: "object", required: false }, customFields: { type: "object", required: false } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); return api(url, apiKey, "POST", "/v1/alert", input as Record<string, unknown>); } });

  rl.registerAction("alert.get", { description: "Get an alert by ID", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); return api(url, apiKey, "GET", `/v1/alert/${(input as Record<string, unknown>).id}`); } });

  rl.registerAction("alert.update", { description: "Update an alert by ID",
    inputSchema: { id: { type: "string", required: true }, title: { type: "string", required: false }, description: { type: "string", required: false }, severity: { type: "number", required: false }, tlp: { type: "number", required: false }, tags: { type: "object", required: false }, status: { type: "string", required: false }, customFields: { type: "object", required: false } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); const { id, ...body } = input as Record<string, unknown>; await api(url, apiKey, "PATCH", `/v1/alert/${id}`, body); return { success: true }; } });

  rl.registerAction("alert.delete", { description: "Delete an alert", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); await api(url, apiKey, "DELETE", `/v1/alert/${(input as Record<string, unknown>).id}`); return { success: true }; } });

  searchAction(rl, "alert.search", "listAlert", "Search alerts");

  rl.registerAction("alert.merge", { description: "Merge an alert into a case",
    inputSchema: { alertId: { type: "string", required: true }, caseId: { type: "string", required: true } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); const p = input as Record<string, unknown>; return api(url, apiKey, "POST", `/alert/${p.alertId}/merge/${p.caseId}`); } });

  rl.registerAction("alert.promote", { description: "Promote an alert to a case",
    inputSchema: { id: { type: "string", required: true }, caseTemplate: { type: "string", required: false } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); const p = input as Record<string, unknown>; const body: Record<string, unknown> = {}; if (p.caseTemplate) body.caseTemplate = p.caseTemplate; return api(url, apiKey, "POST", `/v1/alert/${p.id}/case`, body); } });

  rl.registerAction("alert.setStatus", { description: "Set alert status",
    inputSchema: { id: { type: "string", required: true }, status: { type: "string", required: true } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); const p = input as Record<string, unknown>; await api(url, apiKey, "PATCH", `/v1/alert/${p.id}`, { status: p.status }); return { success: true }; } });

  // ── Case ────────────────────────────────────────────

  rl.registerAction("case.create", { description: "Create a case",
    inputSchema: { title: { type: "string", required: true }, description: { type: "string", required: false }, severity: { type: "number", required: false }, tlp: { type: "number", required: false }, tags: { type: "object", required: false }, assignee: { type: "string", required: false }, customFields: { type: "object", required: false } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); return api(url, apiKey, "POST", "/v1/case", input as Record<string, unknown>); } });

  rl.registerAction("case.get", { description: "Get a case by ID", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); return api(url, apiKey, "POST", "/v1/query", { query: [{ _name: "getCase", idOrName: (input as Record<string, unknown>).id }, { _name: "page", from: 0, to: 10, extraData: ["attachmentCount"] }] }); } });

  rl.registerAction("case.update", { description: "Update a case by ID",
    inputSchema: { id: { type: "string", required: true }, title: { type: "string", required: false }, description: { type: "string", required: false }, severity: { type: "number", required: false }, tlp: { type: "number", required: false }, tags: { type: "object", required: false }, status: { type: "string", required: false }, assignee: { type: "string", required: false }, customFields: { type: "object", required: false } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); const { id, ...body } = input as Record<string, unknown>; await api(url, apiKey, "PATCH", `/v1/case/${id}`, body); return { success: true }; } });

  rl.registerAction("case.delete", { description: "Delete a case", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); await api(url, apiKey, "DELETE", `/v1/case/${(input as Record<string, unknown>).id}`); return { success: true }; } });

  searchAction(rl, "case.search", "listCase", "Search cases");

  rl.registerAction("case.getTimeline", { description: "Get case timeline", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); return api(url, apiKey, "GET", `/v1/case/${(input as Record<string, unknown>).id}/timeline`); } });

  // ── Task ────────────────────────────────────────────

  rl.registerAction("task.create", { description: "Create a task in a case",
    inputSchema: { caseId: { type: "string", required: true }, title: { type: "string", required: true }, description: { type: "string", required: false }, status: { type: "string", required: false }, flag: { type: "boolean", required: false }, assignee: { type: "string", required: false } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); const { caseId, ...body } = input as Record<string, unknown>; return api(url, apiKey, "POST", `/v1/case/${caseId}/task`, body); } });

  rl.registerAction("task.get", { description: "Get a task by ID", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); return api(url, apiKey, "POST", "/v1/query", { query: [{ _name: "getTask", idOrName: (input as Record<string, unknown>).id }] }); } });

  rl.registerAction("task.update", { description: "Update a task by ID",
    inputSchema: { id: { type: "string", required: true }, title: { type: "string", required: false }, description: { type: "string", required: false }, status: { type: "string", required: false }, flag: { type: "boolean", required: false }, assignee: { type: "string", required: false } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); const { id, ...body } = input as Record<string, unknown>; await api(url, apiKey, "PATCH", `/v1/task/${id}`, body); return { success: true }; } });

  rl.registerAction("task.delete", { description: "Delete a task", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); await api(url, apiKey, "DELETE", `/v1/task/${(input as Record<string, unknown>).id}`); return { success: true }; } });

  searchAction(rl, "task.search", "listTask", "Search tasks");

  // ── Observable ──────────────────────────────────────

  rl.registerAction("observable.create", { description: "Create an observable in a case or alert",
    inputSchema: { createIn: { type: "string", required: true, description: "case or alert" }, parentId: { type: "string", required: true, description: "Case or alert ID" }, dataType: { type: "string", required: true }, data: { type: "string", required: false, description: "Value (for non-file types)" }, message: { type: "string", required: false }, tlp: { type: "number", required: false }, tags: { type: "object", required: false }, ioc: { type: "boolean", required: false } },
    async execute(input, ctx) {
      const { url, apiKey } = getConn(ctx);
      const { createIn, parentId, ...body } = input as Record<string, unknown>;
      return api(url, apiKey, "POST", `/v1/${createIn}/${parentId}/observable`, body);
    } });

  rl.registerAction("observable.get", { description: "Get an observable by ID", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); return api(url, apiKey, "POST", "/v1/query", { query: [{ _name: "getObservable", idOrName: (input as Record<string, unknown>).id }] }); } });

  rl.registerAction("observable.update", { description: "Update an observable by ID",
    inputSchema: { id: { type: "string", required: true }, message: { type: "string", required: false }, tlp: { type: "number", required: false }, tags: { type: "object", required: false }, ioc: { type: "boolean", required: false }, sighted: { type: "boolean", required: false } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); const { id, ...body } = input as Record<string, unknown>; await api(url, apiKey, "PATCH", `/v1/observable/${id}`, body); return { success: true }; } });

  rl.registerAction("observable.delete", { description: "Delete an observable", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); await api(url, apiKey, "DELETE", `/v1/observable/${(input as Record<string, unknown>).id}`); return { success: true }; } });

  searchAction(rl, "observable.search", "listObservable", "Search observables");

  // ── Comment ─────────────────────────────────────────

  rl.registerAction("comment.add", { description: "Add a comment to a case or alert",
    inputSchema: { addTo: { type: "string", required: true, description: "case or alert" }, parentId: { type: "string", required: true }, message: { type: "string", required: true } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); const p = input as Record<string, unknown>; return api(url, apiKey, "POST", `/v1/${p.addTo}/${p.parentId}/comment`, { message: p.message }); } });

  rl.registerAction("comment.update", { description: "Update a comment",
    inputSchema: { id: { type: "string", required: true }, message: { type: "string", required: true } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); const p = input as Record<string, unknown>; return api(url, apiKey, "PATCH", `/v1/comment/${p.id}`, { message: p.message }); } });

  rl.registerAction("comment.delete", { description: "Delete a comment", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); await api(url, apiKey, "DELETE", `/v1/comment/${(input as Record<string, unknown>).id}`); return { success: true }; } });

  searchAction(rl, "comment.search", "listComment", "Search comments");

  // ── Task Log ────────────────────────────────────────

  rl.registerAction("log.create", { description: "Create a task log entry",
    inputSchema: { taskId: { type: "string", required: true }, message: { type: "string", required: true }, startDate: { type: "string", required: false }, includeInTimeline: { type: "string", required: false } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); const { taskId, ...body } = input as Record<string, unknown>; return api(url, apiKey, "POST", `/v1/task/${taskId}/log`, body); } });

  rl.registerAction("log.get", { description: "Get a log entry by ID", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); return api(url, apiKey, "POST", "/v1/query", { query: [{ _name: "getLog", idOrName: (input as Record<string, unknown>).id }] }); } });

  rl.registerAction("log.delete", { description: "Delete a log entry", inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); await api(url, apiKey, "DELETE", `/v1/log/${(input as Record<string, unknown>).id}`); return { success: true }; } });

  searchAction(rl, "log.search", "listLog", "Search task logs");

  // ── Page ────────────────────────────────────────────

  rl.registerAction("page.create", { description: "Create a page (case page or knowledge base)",
    inputSchema: { caseId: { type: "string", required: false, description: "If omitted, creates in knowledge base" }, title: { type: "string", required: true }, category: { type: "string", required: true }, content: { type: "string", required: true } },
    async execute(input, ctx) {
      const { url, apiKey } = getConn(ctx);
      const { caseId, ...body } = input as Record<string, unknown>;
      const endpoint = caseId ? `/v1/case/${caseId}/page` : "/v1/page";
      return api(url, apiKey, "POST", endpoint, body);
    } });

  rl.registerAction("page.update", { description: "Update a page",
    inputSchema: { pageId: { type: "string", required: true }, caseId: { type: "string", required: false }, content: { type: "string", required: false }, title: { type: "string", required: false }, category: { type: "string", required: false }, order: { type: "number", required: false } },
    async execute(input, ctx) {
      const { url, apiKey } = getConn(ctx);
      const { pageId, caseId, ...body } = input as Record<string, unknown>;
      const endpoint = caseId ? `/v1/case/${caseId}/page/${pageId}` : `/v1/page/${pageId}`;
      return api(url, apiKey, "PATCH", endpoint, body);
    } });

  rl.registerAction("page.delete", { description: "Delete a page",
    inputSchema: { pageId: { type: "string", required: true }, caseId: { type: "string", required: false } },
    async execute(input, ctx) {
      const { url, apiKey } = getConn(ctx);
      const p = input as Record<string, unknown>;
      const endpoint = p.caseId ? `/v1/case/${p.caseId}/page/${p.pageId}` : `/v1/page/${p.pageId}`;
      await api(url, apiKey, "DELETE", endpoint);
      return { success: true };
    } });

  searchAction(rl, "page.search", "listOrganisationPage", "Search pages");

  // ── Query ───────────────────────────────────────────

  rl.registerAction("query.execute", { description: "Execute a raw TheHive Query API request",
    inputSchema: { query: { type: "object", required: true, description: "Array of query operations" } },
    async execute(input, ctx) { const { url, apiKey } = getConn(ctx); return api(url, apiKey, "POST", "/v1/query", { query: (input as Record<string, unknown>).query }); } });
}
