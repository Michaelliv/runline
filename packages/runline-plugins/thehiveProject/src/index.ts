import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { thehiveProjectCredential } from "./credentials.js";

function api(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, thehiveProjectCredential, "thehiveProject", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

// TheHive v1 query API — paginated search
async function query(
  ctx: ActionContext,
  queryName: string,
  filters?: Record<string, unknown>[],
  sortFields?: Record<string, unknown>[],
  limit?: number,
): Promise<unknown> {
  const q: Record<string, unknown>[] = [{ _name: queryName }];
  if (filters && filters.length) q.push({ _name: "filter", _and: filters });
  if (sortFields && sortFields.length)
    q.push({ _name: "sort", _fields: sortFields });
  if (limit) {
    q.push({ _name: "page", from: 0, to: limit });
    return api(ctx, "POST", "v1/query", { query: q });
  }
  // Paginate in batches of 500
  const results: unknown[] = [];
  let from = 0;
  let batch: unknown[];
  do {
    batch = ((await api(ctx, "POST", "v1/query", {
      query: [...q, { _name: "page", from, to: from + 500 }],
    })) ?? []) as unknown[];
    results.push(...batch);
    from += 500;
  } while (batch.length > 0);
  return results;
}

function searchAction(
  rl: RunlinePluginAPI,
  name: string,
  queryName: string,
  description: string,
) {
  rl.registerAction(name, {
    access: "read",
    description,
    inputSchema: {
      limit: { type: "number", required: false },
      filters: {
        type: "object",
        required: false,
        description: "Array of filter objects",
      },
      sort: {
        type: "object",
        required: false,
        description: "Array of sort field objects",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return query(
        ctx,
        queryName,
        p.filters as Record<string, unknown>[] | undefined,
        p.sort as Record<string, unknown>[] | undefined,
        p.limit as number | undefined,
      );
    },
  });
}

export default function theHiveProject(rl: RunlinePluginAPI) {
  rl.setName("thehiveProject");
  rl.setVersion("0.1.0");
  rl.setCredential(thehiveProjectCredential);
  rl.setConnectionSchema({
    url: {
      type: "string",
      required: true,
      description: "TheHive instance URL",
      env: "THEHIVE_URL",
    },
    apiKey: {
      type: "string",
      required: true,
      description: "API key",
      env: "THEHIVE_API_KEY",
    },
  });

  // ── Alert ───────────────────────────────────────────

  rl.registerAction("alert.create", {
    access: "write",
    description: "Create an alert",
    inputSchema: {
      type: { type: "string", required: true },
      source: { type: "string", required: true },
      sourceRef: { type: "string", required: true },
      title: { type: "string", required: true },
      description: { type: "string", required: false },
      severity: { type: "number", required: false },
      tlp: { type: "number", required: false },
      tags: { type: "object", required: false },
      customFields: { type: "object", required: false },
    },
    async execute(input, ctx) {
      return api(ctx, "POST", "v1/alert", input as Record<string, unknown>);
    },
  });

  rl.registerAction("alert.get", {
    access: "read",
    description: "Get an alert by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `v1/alert/${pathSegment((input as Record<string, unknown>).id)}`,
      );
    },
  });

  rl.registerAction("alert.update", {
    access: "write",
    description: "Update an alert by ID",
    inputSchema: {
      id: { type: "string", required: true },
      title: { type: "string", required: false },
      description: { type: "string", required: false },
      severity: { type: "number", required: false },
      tlp: { type: "number", required: false },
      tags: { type: "object", required: false },
      status: { type: "string", required: false },
      customFields: { type: "object", required: false },
    },
    async execute(input, ctx) {
      const { id, ...body } = input as Record<string, unknown>;
      await api(ctx, "PATCH", `v1/alert/${pathSegment(id)}`, body);
      return { success: true };
    },
  });

  rl.registerAction("alert.delete", {
    access: "write",
    description: "Delete an alert",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `v1/alert/${pathSegment((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });

  searchAction(rl, "alert.search", "listAlert", "Search alerts");

  rl.registerAction("alert.merge", {
    access: "write",
    description: "Merge an alert into a case",
    inputSchema: {
      alertId: { type: "string", required: true },
      caseId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(
        ctx,
        "POST",
        `alert/${pathSegment(p.alertId)}/merge/${pathSegment(p.caseId)}`,
      );
    },
  });

  rl.registerAction("alert.promote", {
    access: "write",
    description: "Promote an alert to a case",
    inputSchema: {
      id: { type: "string", required: true },
      caseTemplate: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (p.caseTemplate) body.caseTemplate = p.caseTemplate;
      return api(ctx, "POST", `v1/alert/${pathSegment(p.id)}/case`, body);
    },
  });

  rl.registerAction("alert.setStatus", {
    access: "write",
    description: "Set alert status",
    inputSchema: {
      id: { type: "string", required: true },
      status: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      await api(ctx, "PATCH", `v1/alert/${pathSegment(p.id)}`, {
        status: p.status,
      });
      return { success: true };
    },
  });

  // ── Case ────────────────────────────────────────────

  rl.registerAction("case.create", {
    access: "write",
    description: "Create a case",
    inputSchema: {
      title: { type: "string", required: true },
      description: { type: "string", required: false },
      severity: { type: "number", required: false },
      tlp: { type: "number", required: false },
      tags: { type: "object", required: false },
      assignee: { type: "string", required: false },
      customFields: { type: "object", required: false },
    },
    async execute(input, ctx) {
      return api(ctx, "POST", "v1/case", input as Record<string, unknown>);
    },
  });

  rl.registerAction("case.get", {
    access: "read",
    description: "Get a case by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(ctx, "POST", "v1/query", {
        query: [
          { _name: "getCase", idOrName: (input as Record<string, unknown>).id },
          { _name: "page", from: 0, to: 10, extraData: ["attachmentCount"] },
        ],
      });
    },
  });

  rl.registerAction("case.update", {
    access: "write",
    description: "Update a case by ID",
    inputSchema: {
      id: { type: "string", required: true },
      title: { type: "string", required: false },
      description: { type: "string", required: false },
      severity: { type: "number", required: false },
      tlp: { type: "number", required: false },
      tags: { type: "object", required: false },
      status: { type: "string", required: false },
      assignee: { type: "string", required: false },
      customFields: { type: "object", required: false },
    },
    async execute(input, ctx) {
      const { id, ...body } = input as Record<string, unknown>;
      await api(ctx, "PATCH", `v1/case/${pathSegment(id)}`, body);
      return { success: true };
    },
  });

  rl.registerAction("case.delete", {
    access: "write",
    description: "Delete a case",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `v1/case/${pathSegment((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });

  searchAction(rl, "case.search", "listCase", "Search cases");

  rl.registerAction("case.getTimeline", {
    access: "read",
    description: "Get case timeline",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `v1/case/${pathSegment((input as Record<string, unknown>).id)}/timeline`,
      );
    },
  });

  // ── Task ────────────────────────────────────────────

  rl.registerAction("task.create", {
    access: "write",
    description: "Create a task in a case",
    inputSchema: {
      caseId: { type: "string", required: true },
      title: { type: "string", required: true },
      description: { type: "string", required: false },
      status: { type: "string", required: false },
      flag: { type: "boolean", required: false },
      assignee: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { caseId, ...body } = input as Record<string, unknown>;
      return api(ctx, "POST", `v1/case/${pathSegment(caseId)}/task`, body);
    },
  });

  rl.registerAction("task.get", {
    access: "read",
    description: "Get a task by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(ctx, "POST", "v1/query", {
        query: [
          { _name: "getTask", idOrName: (input as Record<string, unknown>).id },
        ],
      });
    },
  });

  rl.registerAction("task.update", {
    access: "write",
    description: "Update a task by ID",
    inputSchema: {
      id: { type: "string", required: true },
      title: { type: "string", required: false },
      description: { type: "string", required: false },
      status: { type: "string", required: false },
      flag: { type: "boolean", required: false },
      assignee: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { id, ...body } = input as Record<string, unknown>;
      await api(ctx, "PATCH", `v1/task/${pathSegment(id)}`, body);
      return { success: true };
    },
  });

  rl.registerAction("task.delete", {
    access: "write",
    description: "Delete a task",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `v1/task/${pathSegment((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });

  searchAction(rl, "task.search", "listTask", "Search tasks");

  // ── Observable ──────────────────────────────────────

  rl.registerAction("observable.create", {
    access: "write",
    description: "Create an observable in a case or alert",
    inputSchema: {
      createIn: {
        type: "string",
        required: true,
        description: "case or alert",
      },
      parentId: {
        type: "string",
        required: true,
        description: "Case or alert ID",
      },
      dataType: { type: "string", required: true },
      data: {
        type: "string",
        required: false,
        description: "Value (for non-file types)",
      },
      message: { type: "string", required: false },
      tlp: { type: "number", required: false },
      tags: { type: "object", required: false },
      ioc: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const { createIn, parentId, ...body } = input as Record<string, unknown>;
      return api(
        ctx,
        "POST",
        `v1/${pathSegment(createIn)}/${pathSegment(parentId)}/observable`,
        body,
      );
    },
  });

  rl.registerAction("observable.get", {
    access: "read",
    description: "Get an observable by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(ctx, "POST", "v1/query", {
        query: [
          {
            _name: "getObservable",
            idOrName: (input as Record<string, unknown>).id,
          },
        ],
      });
    },
  });

  rl.registerAction("observable.update", {
    access: "write",
    description: "Update an observable by ID",
    inputSchema: {
      id: { type: "string", required: true },
      message: { type: "string", required: false },
      tlp: { type: "number", required: false },
      tags: { type: "object", required: false },
      ioc: { type: "boolean", required: false },
      sighted: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const { id, ...body } = input as Record<string, unknown>;
      await api(ctx, "PATCH", `v1/observable/${pathSegment(id)}`, body);
      return { success: true };
    },
  });

  rl.registerAction("observable.delete", {
    access: "write",
    description: "Delete an observable",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `v1/observable/${pathSegment((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });

  searchAction(rl, "observable.search", "listObservable", "Search observables");

  // ── Comment ─────────────────────────────────────────

  rl.registerAction("comment.add", {
    access: "write",
    description: "Add a comment to a case or alert",
    inputSchema: {
      addTo: { type: "string", required: true, description: "case or alert" },
      parentId: { type: "string", required: true },
      message: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(
        ctx,
        "POST",
        `v1/${pathSegment(p.addTo)}/${pathSegment(p.parentId)}/comment`,
        {
          message: p.message,
        },
      );
    },
  });

  rl.registerAction("comment.update", {
    access: "write",
    description: "Update a comment",
    inputSchema: {
      id: { type: "string", required: true },
      message: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(ctx, "PATCH", `v1/comment/${pathSegment(p.id)}`, {
        message: p.message,
      });
    },
  });

  rl.registerAction("comment.delete", {
    access: "write",
    description: "Delete a comment",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `v1/comment/${pathSegment((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });

  searchAction(rl, "comment.search", "listComment", "Search comments");

  // ── Task Log ────────────────────────────────────────

  rl.registerAction("log.create", {
    access: "write",
    description: "Create a task log entry",
    inputSchema: {
      taskId: { type: "string", required: true },
      message: { type: "string", required: true },
      startDate: { type: "string", required: false },
      includeInTimeline: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { taskId, ...body } = input as Record<string, unknown>;
      return api(ctx, "POST", `v1/task/${pathSegment(taskId)}/log`, body);
    },
  });

  rl.registerAction("log.get", {
    access: "read",
    description: "Get a log entry by ID",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(ctx, "POST", "v1/query", {
        query: [
          { _name: "getLog", idOrName: (input as Record<string, unknown>).id },
        ],
      });
    },
  });

  rl.registerAction("log.delete", {
    access: "write",
    description: "Delete a log entry",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `v1/log/${pathSegment((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });

  searchAction(rl, "log.search", "listLog", "Search task logs");

  // ── Page ────────────────────────────────────────────

  rl.registerAction("page.create", {
    access: "write",
    description: "Create a page (case page or knowledge base)",
    inputSchema: {
      caseId: {
        type: "string",
        required: false,
        description: "If omitted, creates in knowledge base",
      },
      title: { type: "string", required: true },
      category: { type: "string", required: true },
      content: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const { caseId, ...body } = input as Record<string, unknown>;
      const endpoint = caseId
        ? `v1/case/${pathSegment(caseId)}/page`
        : "v1/page";
      return api(ctx, "POST", endpoint, body);
    },
  });

  rl.registerAction("page.update", {
    access: "write",
    description: "Update a page",
    inputSchema: {
      pageId: { type: "string", required: true },
      caseId: { type: "string", required: false },
      content: { type: "string", required: false },
      title: { type: "string", required: false },
      category: { type: "string", required: false },
      order: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const { pageId, caseId, ...body } = input as Record<string, unknown>;
      const endpoint = caseId
        ? `v1/case/${pathSegment(caseId)}/page/${pathSegment(pageId)}`
        : `v1/page/${pathSegment(pageId)}`;
      return api(ctx, "PATCH", endpoint, body);
    },
  });

  rl.registerAction("page.delete", {
    access: "write",
    description: "Delete a page",
    inputSchema: {
      pageId: { type: "string", required: true },
      caseId: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const endpoint = p.caseId
        ? `v1/case/${pathSegment(p.caseId)}/page/${pathSegment(p.pageId)}`
        : `v1/page/${pathSegment(p.pageId)}`;
      await api(ctx, "DELETE", endpoint);
      return { success: true };
    },
  });

  searchAction(rl, "page.search", "listOrganisationPage", "Search pages");

  // ── Query ───────────────────────────────────────────

  rl.registerAction("query.execute", {
    access: "read",
    description: "Execute a raw TheHive Query API request",
    inputSchema: {
      query: {
        type: "object",
        required: true,
        description: "Array of query operations",
      },
    },
    async execute(input, ctx) {
      return api(ctx, "POST", "v1/query", {
        query: (input as Record<string, unknown>).query,
      });
    },
  });
}
