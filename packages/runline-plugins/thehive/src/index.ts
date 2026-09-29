import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { thehiveCredential } from "./credentials.js";

async function api(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, thehiveCredential, "thehive", {
    target: "api",
    path: endpoint,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

export default function thehive(rl: RunlinePluginAPI) {
  rl.setName("thehive");
  rl.setVersion("0.1.0");
  rl.setCredential(thehiveCredential);
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
      description: "TheHive API key",
      env: "THEHIVE_API_KEY",
    },
  });

  // ── Alert ───────────────────────────────────────────

  rl.registerAction("alert.create", {
    access: "write",
    description: "Create an alert",
    inputSchema: {
      title: { type: "string", required: true },
      description: { type: "string", required: true },
      severity: { type: "number", required: true, description: "1-4" },
      type: { type: "string", required: true },
      source: { type: "string", required: true },
      sourceRef: { type: "string", required: true },
      tlp: { type: "number", required: false },
      tags: { type: "string", required: false, description: "Comma-separated" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { ...p, date: Date.now() };
      if (p.tags)
        body.tags = (p.tags as string).split(",").map((t) => t.trim());
      return api(ctx, "POST", "alert", body);
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
        `alert/${pathSegment((input as Record<string, unknown>).id)}`,
      );
    },
  });

  rl.registerAction("alert.list", {
    access: "read",
    description: "List alerts",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body = { query: [{ _name: "listAlert" }] } as Record<
        string,
        unknown
      >;
      if (p.limit)
        (body.query as unknown[]).push({ _name: "page", from: 0, to: p.limit });
      return api(ctx, "POST", "v1/query", body, { name: "alerts" });
    },
  });

  rl.registerAction("alert.update", {
    access: "write",
    description: "Update an alert",
    inputSchema: {
      id: { type: "string", required: true },
      data: { type: "object", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(
        ctx,
        "PATCH",
        `alert/${pathSegment(p.id)}`,
        p.data as Record<string, unknown>,
      );
    },
  });

  rl.registerAction("alert.markAsRead", {
    access: "write",
    description: "Mark an alert as read",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "POST",
        `alert/${pathSegment((input as Record<string, unknown>).id)}/markAsRead`,
      );
    },
  });

  rl.registerAction("alert.markAsUnread", {
    access: "write",
    description: "Mark an alert as unread",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "POST",
        `alert/${pathSegment((input as Record<string, unknown>).id)}/markAsUnread`,
      );
    },
  });

  rl.registerAction("alert.promote", {
    access: "write",
    description: "Promote an alert to a case",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "POST",
        `alert/${pathSegment((input as Record<string, unknown>).id)}/createCase`,
      );
    },
  });

  rl.registerAction("alert.merge", {
    access: "write",
    description: "Merge an alert into an existing case",
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

  // ── Case ────────────────────────────────────────────

  rl.registerAction("case.create", {
    access: "write",
    description: "Create a case",
    inputSchema: {
      title: { type: "string", required: true },
      description: { type: "string", required: true },
      severity: { type: "number", required: true },
      tlp: { type: "number", required: false },
      tags: { type: "string", required: false, description: "Comma-separated" },
      owner: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = { ...p, startDate: Date.now() };
      if (p.tags)
        body.tags = (p.tags as string).split(",").map((t) => t.trim());
      return api(ctx, "POST", "case", body);
    },
  });

  rl.registerAction("case.get", {
    access: "read",
    description: "Get a case",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `case/${pathSegment((input as Record<string, unknown>).id)}`,
      );
    },
  });

  rl.registerAction("case.list", {
    access: "read",
    description: "List cases",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body = { query: [{ _name: "listCase" }] } as Record<
        string,
        unknown
      >;
      if (p.limit)
        (body.query as unknown[]).push({ _name: "page", from: 0, to: p.limit });
      return api(ctx, "POST", "v1/query", body, { name: "cases" });
    },
  });

  rl.registerAction("case.update", {
    access: "write",
    description: "Update a case",
    inputSchema: {
      id: { type: "string", required: true },
      data: { type: "object", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(
        ctx,
        "PATCH",
        `case/${pathSegment(p.id)}`,
        p.data as Record<string, unknown>,
      );
    },
  });

  // ── Observable ──────────────────────────────────────

  rl.registerAction("observable.create", {
    access: "write",
    description: "Create an observable on a case",
    inputSchema: {
      caseId: { type: "string", required: true },
      dataType: { type: "string", required: true },
      data: { type: "string", required: true },
      message: { type: "string", required: false },
      tlp: { type: "number", required: false },
      ioc: { type: "boolean", required: false },
      sighted: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const { caseId, ...body } = input as Record<string, unknown>;
      return api(ctx, "POST", `case/${pathSegment(caseId)}/artifact`, body);
    },
  });

  rl.registerAction("observable.get", {
    access: "read",
    description: "Get an observable",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "POST",
        "v1/query",
        {
          query: [
            {
              _name: "getObservable",
              idOrName: (input as Record<string, unknown>).id,
            },
          ],
        },
        { name: "get-observable" },
      );
    },
  });

  rl.registerAction("observable.list", {
    access: "read",
    description: "List observables for a case",
    inputSchema: {
      caseId: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body = {
        query: [
          { _name: "getCase", idOrName: p.caseId },
          { _name: "observables" },
        ],
      } as Record<string, unknown>;
      if (p.limit)
        (body.query as unknown[]).push({ _name: "page", from: 0, to: p.limit });
      return api(ctx, "POST", "v1/query", body, {
        name: "observables",
      });
    },
  });

  rl.registerAction("observable.update", {
    access: "write",
    description: "Update an observable",
    inputSchema: {
      id: { type: "string", required: true },
      data: { type: "object", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(
        ctx,
        "PATCH",
        `case/artifact/${pathSegment(p.id)}`,
        p.data as Record<string, unknown>,
      );
    },
  });

  // ── Task ────────────────────────────────────────────

  rl.registerAction("task.create", {
    access: "write",
    description: "Create a task on a case",
    inputSchema: {
      caseId: { type: "string", required: true },
      title: { type: "string", required: true },
      status: {
        type: "string",
        required: false,
        description: "Waiting, InProgress, Completed, Cancel",
      },
      flag: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const { caseId, ...body } = input as Record<string, unknown>;
      return api(ctx, "POST", `case/${pathSegment(caseId)}/task`, body);
    },
  });

  rl.registerAction("task.get", {
    access: "read",
    description: "Get a task",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "POST",
        "v1/query",
        {
          query: [
            {
              _name: "getTask",
              idOrName: (input as Record<string, unknown>).id,
            },
          ],
        },
        { name: "get-task" },
      );
    },
  });

  rl.registerAction("task.list", {
    access: "read",
    description: "List tasks for a case",
    inputSchema: {
      caseId: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body = {
        query: [{ _name: "getCase", idOrName: p.caseId }, { _name: "tasks" }],
      } as Record<string, unknown>;
      if (p.limit)
        (body.query as unknown[]).push({ _name: "page", from: 0, to: p.limit });
      return api(ctx, "POST", "v1/query", body, {
        name: "case-tasks",
      });
    },
  });

  rl.registerAction("task.update", {
    access: "write",
    description: "Update a task",
    inputSchema: {
      id: { type: "string", required: true },
      data: { type: "object", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(
        ctx,
        "PATCH",
        `case/task/${pathSegment(p.id)}`,
        p.data as Record<string, unknown>,
      );
    },
  });

  // ── Log ─────────────────────────────────────────────

  rl.registerAction("log.create", {
    access: "write",
    description: "Create a log entry on a task",
    inputSchema: {
      taskId: { type: "string", required: true },
      message: { type: "string", required: true },
      status: { type: "string", required: false, description: "Ok, Deleted" },
    },
    async execute(input, ctx) {
      const { taskId, ...body } = input as Record<string, unknown>;
      (body as Record<string, unknown>).startDate = Date.now();
      return api(ctx, "POST", `case/task/${pathSegment(taskId)}/log`, body);
    },
  });

  rl.registerAction("log.get", {
    access: "read",
    description: "Get a log entry",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "POST",
        "v1/query",
        {
          query: [
            {
              _name: "getLog",
              idOrName: (input as Record<string, unknown>).id,
            },
          ],
        },
        { name: "get-log" },
      );
    },
  });

  rl.registerAction("log.list", {
    access: "read",
    description: "List logs for a task",
    inputSchema: {
      taskId: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body = {
        query: [{ _name: "getTask", idOrName: p.taskId }, { _name: "logs" }],
      } as Record<string, unknown>;
      if (p.limit)
        (body.query as unknown[]).push({ _name: "page", from: 0, to: p.limit });
      return api(ctx, "POST", "v1/query", body, {
        name: "case-task-logs",
      });
    },
  });
}
