/**
 * Google Tasks plugin for runline.
 *
 * OAuth2 user flow, same shape as the rest of the Google plugins.
 * Scope: `auth/tasks` (full read/write).
 *
 * Surface area:
 *
 *   taskList.create / taskList.get / taskList.list /
 *   taskList.update / taskList.delete
 *
 *   task.create / task.get / task.list / task.update / task.delete
 *   task.move        (reorder / reparent within a list)
 *   task.clear       (hide all completed tasks in a list)
 *
 * Dates passed via `due`, `completed`, `completedMin/Max`,
 * `dueMin/Max`, `updatedMin` may be ISO strings (`"2024-12-25"`,
 * `"2024-12-25T10:00:00Z"`) or already-RFC3339-formatted strings.
 * Google's Tasks API is strict about RFC3339 with a timezone — we
 * normalize ISO input via `Date.toISOString()` when detected.
 */

import type { ActionContext, RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { googleAccessToken } from "../../_shared/googleAuth.js";
import {
  GoogleTimestamp,
  Id,
  stringEnum,
} from "../../_shared/googleSchemas.js";

// ─── Types ───────────────────────────────────────────────────────

type Ctx = ActionContext;

type GoogleTasksConfig = {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  serviceAccountJson?: string;
  serviceAccountEmail?: string;
  serviceAccountPrivateKey?: string;
  serviceAccountSubject?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
};

// ─── Auth ────────────────────────────────────────────────────────

async function accessToken(ctx: Ctx): Promise<string> {
  return googleAccessToken(ctx, "googleTasks", SCOPES);
}

// ─── Request ─────────────────────────────────────────────────────

const API_BASE = "https://tasks.googleapis.com/tasks/v1";

async function tasksRequest(
  ctx: Ctx,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const token = await accessToken(ctx);
  const url = new URL(`${API_BASE}${path}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  };
  if (body && Object.keys(body).length > 0) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url.toString(), init);
  if (res.status === 204) return { success: true };
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`googleTasks: ${method} ${path} → ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : { success: true };
}

async function paginateAll(
  ctx: Ctx,
  path: string,
  qs: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const query: Record<string, unknown> = { ...qs, maxResults: qs.maxResults ?? 100 };
  do {
    const page = (await tasksRequest(ctx, "GET", path, undefined, query)) as {
      items?: Record<string, unknown>[];
      nextPageToken?: string;
    };
    out.push(...(page.items ?? []));
    query.pageToken = page.nextPageToken;
  } while (query.pageToken);
  return out;
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Normalize a date/time value for the Tasks API. Accepts ISO strings,
 * epoch numbers, or already-RFC3339 strings. Google demands RFC3339
 * with a timezone (`Z` or `+01:00`) on `due`, `completed`, and the
 * `completedMin/Max`/`dueMin/Max`/`updatedMin` filters.
 */
function toRFC3339(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") {
    // If it already looks like RFC3339 (ends with Z or a numeric offset), pass through.
    if (/Z$|[+-]\d{2}:?\d{2}$/.test(v)) return v;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`googleTasks: invalid date "${v}"`);
    }
    return d.toISOString();
  }
  if (typeof v === "number") {
    return new Date(v).toISOString();
  }
  throw new Error("googleTasks: date must be an ISO string or epoch milliseconds");
}

// ─── Plugin ──────────────────────────────────────────────────────

const SCOPES = ["https://www.googleapis.com/auth/tasks"];

const taskStatusSchema = stringEnum(["needsAction", "completed"] as const);
const pageSizeSchema = t.Integer({ minimum: 1, maximum: 100 });

export default function googleTasks(rl: RunlinePluginAPI) {
  rl.setName("googleTasks");
  rl.setVersion("0.1.0");

  rl.setOAuth({
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: SCOPES,
    authParams: { access_type: "offline", prompt: "consent" },
    setupHelp: [
      "You need a Google Cloud OAuth client. Takes ~5 minutes, one time.",
      "",
      "1. Create or pick a Google Cloud project:",
      "     https://console.cloud.google.com/projectcreate",
      "",
      "2. Enable the Google Tasks API:",
      "     https://console.cloud.google.com/apis/library/tasks.googleapis.com",
      "",
      "3. Configure the OAuth consent screen:",
      "     https://console.cloud.google.com/apis/credentials/consent",
      "     • Audience: External",
      "",
      "4. Add yourself as a test user:",
      "     https://console.cloud.google.com/auth/audience",
      "",
      "5. Create the OAuth client:",
      "     https://console.cloud.google.com/apis/credentials",
      "     • + Create credentials → OAuth client ID",
      "     • Application type: Web application",
      "     • Authorized redirect URIs → + Add URI: {{redirectUri}}",
      "",
      "6. Paste the Client ID and Client Secret below, or export",
      "   GOOGLE_TASKS_CLIENT_ID and GOOGLE_TASKS_CLIENT_SECRET.",
    ],
  });

  rl.setConnectionSchema({
    clientId: { type: "string", required: false, env: "GOOGLE_TASKS_CLIENT_ID" },
    clientSecret: { type: "string", required: false, env: "GOOGLE_TASKS_CLIENT_SECRET" },
    refreshToken: { type: "string", required: false, env: "GOOGLE_TASKS_REFRESH_TOKEN" },
    serviceAccountJson: { type: "string", required: false, env: "GOOGLE_TASKS_SERVICE_ACCOUNT_JSON" },
    serviceAccountEmail: { type: "string", required: false, env: "GOOGLE_TASKS_SERVICE_ACCOUNT_EMAIL" },
    serviceAccountPrivateKey: { type: "string", required: false, env: "GOOGLE_TASKS_SERVICE_ACCOUNT_PRIVATE_KEY" },
    serviceAccountSubject: { type: "string", required: false, env: "GOOGLE_TASKS_SERVICE_ACCOUNT_SUBJECT" },
    accessToken: { type: "string", required: false },
    accessTokenExpiresAt: { type: "number", required: false },
  });

  // ── Task lists ────────────────────────────────────────

  rl.registerAction("taskList.list", {
    access: "read",
    description: "List the authenticated user's task lists",
    inputSchema: t.Object(
      {
        returnAll: t.Optional(t.Boolean()),
        maxResults: t.Optional(pageSizeSchema),
        pageToken: t.Optional(Id),
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.pageToken) qs.pageToken = p.pageToken;
      if (p.returnAll) return paginateAll(ctx, "/users/@me/lists", qs);
      if (p.maxResults) qs.maxResults = p.maxResults;
      const res = (await tasksRequest(ctx, "GET", "/users/@me/lists", undefined, qs)) as {
        items?: unknown[];
      };
      return res.items ?? [];
    },
  });

  rl.registerAction("taskList.get", {
    access: "read",
    description: "Get a task list by ID",
    inputSchema: t.Object(
      { taskListId: Id },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return tasksRequest(ctx, "GET", `/users/@me/lists/${p.taskListId}`);
    },
  });

  rl.registerAction("taskList.create", {
    access: "write",
    description: "Create a new task list",
    inputSchema: t.Object(
      { title: t.String() },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return tasksRequest(ctx, "POST", "/users/@me/lists", { title: p.title });
    },
  });

  rl.registerAction("taskList.update", {
    access: "write",
    description: "Update a task list (currently only `title` is writable).",
    inputSchema: t.Object(
      {
        taskListId: Id,
        title: t.String(),
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return tasksRequest(ctx, "PATCH", `/users/@me/lists/${p.taskListId}`, {
        title: p.title,
      });
    },
  });

  rl.registerAction("taskList.delete", {
    access: "write",
    description: "Delete a task list and all its tasks",
    inputSchema: t.Object(
      { taskListId: Id },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      await tasksRequest(ctx, "DELETE", `/users/@me/lists/${p.taskListId}`);
      return { success: true };
    },
  });

  // ── Tasks ─────────────────────────────────────────────

  rl.registerAction("task.create", {
    access: "write",
    description: "Create a task in a list",
    inputSchema: t.Object(
      {
        taskListId: Id,
        title: t.String(),
        notes: t.Optional(t.String()),
        due: t.Optional(GoogleTimestamp),
        status: t.Optional(taskStatusSchema),
        completed: t.Optional(GoogleTimestamp),
        deleted: t.Optional(t.Boolean()),
        parent: t.Optional(
          t.String({
            minLength: 1,
            description: "Parent task ID (nests this task under another)",
          }),
        ),
        previous: t.Optional(
          t.String({
            minLength: 1,
            description: "Insert after this task ID; omit to place at top of level",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = { title: p.title };
      if (p.notes) body.notes = p.notes;
      if (p.status) body.status = p.status;
      if (p.deleted !== undefined) body.deleted = p.deleted;
      const due = toRFC3339(p.due);
      if (due) body.due = due;
      const completed = toRFC3339(p.completed);
      if (completed) body.completed = completed;

      const qs: Record<string, unknown> = {};
      if (p.parent) qs.parent = p.parent;
      if (p.previous) qs.previous = p.previous;

      return tasksRequest(ctx, "POST", `/lists/${p.taskListId}/tasks`, body, qs);
    },
  });

  rl.registerAction("task.get", {
    access: "read",
    description: "Get a single task",
    inputSchema: t.Object(
      {
        taskListId: Id,
        taskId: Id,
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      return tasksRequest(ctx, "GET", `/lists/${p.taskListId}/tasks/${p.taskId}`);
    },
  });

  rl.registerAction("task.list", {
    access: "read",
    description:
      "List tasks in a list. Filters: dueMin/dueMax, completedMin/completedMax, updatedMin, showCompleted/showDeleted/showHidden.",
    inputSchema: t.Object(
      {
        taskListId: Id,
        showCompleted: t.Optional(
          t.Boolean({ description: "Include completed tasks (default: true)" }),
        ),
        showDeleted: t.Optional(t.Boolean()),
        showHidden: t.Optional(t.Boolean()),
        dueMin: t.Optional(GoogleTimestamp),
        dueMax: t.Optional(GoogleTimestamp),
        completedMin: t.Optional(GoogleTimestamp),
        completedMax: t.Optional(GoogleTimestamp),
        updatedMin: t.Optional(GoogleTimestamp),
        returnAll: t.Optional(t.Boolean()),
        maxResults: t.Optional(pageSizeSchema),
        pageToken: t.Optional(Id),
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {
        showCompleted: p.showCompleted ?? true,
        showDeleted: p.showDeleted ?? false,
        showHidden: p.showHidden ?? false,
      };
      for (const k of ["dueMin", "dueMax", "completedMin", "completedMax", "updatedMin"] as const) {
        const v = toRFC3339(p[k]);
        if (v) qs[k] = v;
      }
      if (p.pageToken) qs.pageToken = p.pageToken;
      const path = `/lists/${p.taskListId}/tasks`;
      if (p.returnAll) return paginateAll(ctx, path, qs);
      if (p.maxResults) qs.maxResults = p.maxResults;
      const res = (await tasksRequest(ctx, "GET", path, undefined, qs)) as {
        items?: unknown[];
      };
      return res.items ?? [];
    },
  });

  rl.registerAction("task.update", {
    access: "write",
    description:
      "Patch a task. Only supplied fields are sent. Set status=completed (and optionally `completed` timestamp) to mark done.",
    inputSchema: t.Object(
      {
        taskListId: Id,
        taskId: Id,
        title: t.Optional(t.String()),
        notes: t.Optional(t.String()),
        due: t.Optional(GoogleTimestamp),
        status: t.Optional(taskStatusSchema),
        completed: t.Optional(GoogleTimestamp),
        deleted: t.Optional(t.Boolean()),
      },
      {
        additionalProperties: false,
        anyOf: [
          { required: ["title"] },
          { required: ["notes"] },
          { required: ["due"] },
          { required: ["status"] },
          { required: ["completed"] },
          { required: ["deleted"] },
        ],
      },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (p.title !== undefined) body.title = p.title;
      if (p.notes !== undefined) body.notes = p.notes;
      if (p.status !== undefined) body.status = p.status;
      if (p.deleted !== undefined) body.deleted = p.deleted;
      const due = toRFC3339(p.due);
      if (due) body.due = due;
      const completed = toRFC3339(p.completed);
      if (completed) body.completed = completed;
      if (Object.keys(body).length === 0) {
        throw new Error("googleTasks: nothing to update");
      }
      return tasksRequest(
        ctx,
        "PATCH",
        `/lists/${p.taskListId}/tasks/${p.taskId}`,
        body,
      );
    },
  });

  rl.registerAction("task.delete", {
    access: "write",
    description: "Delete a task",
    inputSchema: t.Object(
      {
        taskListId: Id,
        taskId: Id,
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      await tasksRequest(ctx, "DELETE", `/lists/${p.taskListId}/tasks/${p.taskId}`);
      return { success: true };
    },
  });

  rl.registerAction("task.move", {
    access: "write",
    description:
      "Move a task within its list (reorder or reparent). `parent` nests under another task; `previous` places it after a sibling.",
    inputSchema: t.Object(
      {
        taskListId: Id,
        taskId: Id,
        parent: t.Optional(Id),
        previous: t.Optional(Id),
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.parent) qs.parent = p.parent;
      if (p.previous) qs.previous = p.previous;
      return tasksRequest(
        ctx,
        "POST",
        `/lists/${p.taskListId}/tasks/${p.taskId}/move`,
        undefined,
        qs,
      );
    },
  });

  rl.registerAction("task.clear", {
    access: "write",
    description:
      "Hide all completed tasks in a list from the default view. They remain accessible via task.list with showHidden=true.",
    inputSchema: t.Object(
      { taskListId: Id },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      await tasksRequest(ctx, "POST", `/lists/${p.taskListId}/clear`);
      return { success: true };
    },
  });
}
