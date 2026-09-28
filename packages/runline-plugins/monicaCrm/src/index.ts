import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { monicaCrmCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

function api(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, monicaCrmCredential, "monicaCrm", {
    target: "api",
    path: endpoint,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

function registerCrud(
  rl: RunlinePluginAPI,
  resource: string,
  plural: string,
  createSchema: Record<
    string,
    { type: string; required: boolean; description?: string }
  >,
) {
  rl.registerAction(`${resource}.create`, {
    access: "write",
    description: `Create a ${resource}`,
    inputSchema: createSchema,
    async execute(input, ctx) {
      const data = (await api(
        ctx,
        "POST",
        plural,
        input as Record<string, unknown>,
      )) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction(`${resource}.get`, {
    access: "read",
    description: `Get a ${resource}`,
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const data = (await api(
        ctx,
        "GET",
        `${plural}/${seg((input as Record<string, unknown>).id)}`,
      )) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction(`${resource}.list`, {
    access: "read",
    description: `List ${plural}`,
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {
        limit: ((input ?? {}) as Record<string, unknown>).limit ?? 100,
      };
      const data = (await api(ctx, "GET", plural, undefined, qs)) as Record<
        string,
        unknown
      >;
      return data.data;
    },
  });

  rl.registerAction(`${resource}.update`, {
    access: "write",
    description: `Update a ${resource}`,
    inputSchema: {
      id: { type: "string", required: true },
      data: { type: "object", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await api(
        ctx,
        "PUT",
        `${plural}/${seg(p.id)}`,
        p.data as Record<string, unknown>,
      )) as Record<string, unknown>;
      return data.data;
    },
  });

  rl.registerAction(`${resource}.delete`, {
    access: "write",
    description: `Delete a ${resource}`,
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `${plural}/${seg((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });
}

export default function monicaCrm(rl: RunlinePluginAPI) {
  rl.setName("monicaCrm");
  rl.setVersion("0.1.0");
  rl.setCredential(monicaCrmCredential);
  rl.setConnectionSchema({
    apiToken: {
      type: "string",
      required: true,
      description: "Monica API token",
      env: "MONICA_API_TOKEN",
    },
    url: {
      type: "string",
      required: false,
      description: "Monica URL (default: https://app.monicahq.com)",
      env: "MONICA_URL",
    },
  });

  registerCrud(rl, "contact", "contacts", {
    first_name: { type: "string", required: true },
    last_name: { type: "string", required: false },
    gender_id: { type: "number", required: false },
  });
  registerCrud(rl, "activity", "activities", {
    summary: { type: "string", required: true },
    description: { type: "string", required: false },
    activity_type_id: { type: "number", required: false },
  });
  registerCrud(rl, "note", "notes", {
    contact_id: { type: "number", required: true },
    body: { type: "string", required: true },
  });
  registerCrud(rl, "task", "tasks", {
    title: { type: "string", required: true },
    contact_id: { type: "number", required: false },
  });
  registerCrud(rl, "tag", "tags", {
    name: { type: "string", required: true },
  });
  registerCrud(rl, "journalEntry", "journal", {
    title: { type: "string", required: true },
    post: { type: "string", required: true },
  });
  registerCrud(rl, "reminder", "reminders", {
    contact_id: { type: "number", required: true },
    title: { type: "string", required: true },
    initial_date: { type: "string", required: true },
    frequency_type: {
      type: "string",
      required: true,
      description: "one_time, week, month, year",
    },
  });
  registerCrud(rl, "call", "calls", {
    contact_id: { type: "number", required: true },
    content: { type: "string", required: false },
    called_at: { type: "string", required: false },
  });
  registerCrud(rl, "conversation", "conversations", {
    contact_id: { type: "number", required: true },
    contact_field_type_id: { type: "number", required: true },
    happened_at: { type: "string", required: true },
  });
}
