import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { supabaseCredential } from "./credentials.js";

/** A table's rows, answered back as written (`Prefer: return=representation`). */
function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  table: unknown,
  body?: unknown,
  query?: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<unknown> {
  return credentialJson(ctx, supabaseCredential, "supabase", {
    target: "rest",
    path: pathSegment(table),
    method,
    query,
    headers: { Prefer: "return=representation", ...headers },
    ...(body !== undefined ? { json: body } : {}),
  });
}

export default function supabase(rl: RunlinePluginAPI) {
  rl.setName("supabase");
  rl.setVersion("0.1.0");
  rl.setCredential(supabaseCredential);

  rl.setConnectionSchema({
    host: {
      type: "string",
      required: true,
      description: "Supabase project URL (e.g. https://xxx.supabase.co)",
      env: "SUPABASE_URL",
    },
    serviceRole: {
      type: "string",
      required: true,
      description: "Supabase service_role key",
      env: "SUPABASE_SERVICE_ROLE_KEY",
    },
  });

  rl.registerAction("row.create", {
    access: "write",
    description: "Insert rows into a table",
    inputSchema: {
      table: { type: "string", required: true },
      data: {
        type: "object",
        required: true,
        description: "Row data (or array of rows)",
      },
      schema: {
        type: "string",
        required: false,
        description: "Database schema (default: public)",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const headers: Record<string, string> = {};
      if (p.schema && p.schema !== "public")
        headers["Content-Profile"] = p.schema as string;
      return apiRequest(ctx, "POST", p.table, p.data, undefined, headers);
    },
  });

  rl.registerAction("row.get", {
    access: "read",
    description: "Get rows by filter (PostgREST query params)",
    inputSchema: {
      table: { type: "string", required: true },
      filters: {
        type: "object",
        required: true,
        description: "PostgREST filters, e.g. { id: 'eq.5' }",
      },
      schema: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const headers: Record<string, string> = {};
      if (p.schema && p.schema !== "public")
        headers["Accept-Profile"] = p.schema as string;
      return apiRequest(
        ctx,
        "GET",
        p.table,
        undefined,
        p.filters as Record<string, unknown>,
        headers,
      );
    },
  });

  rl.registerAction("row.list", {
    access: "read",
    description: "List rows from a table",
    inputSchema: {
      table: { type: "string", required: true },
      limit: { type: "number", required: false },
      filters: {
        type: "object",
        required: false,
        description: "PostgREST filters",
      },
      schema: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {
        ...((p.filters as Record<string, unknown>) ?? {}),
      };
      if (p.limit) qs.limit = p.limit;
      const headers: Record<string, string> = {};
      if (p.schema && p.schema !== "public")
        headers["Accept-Profile"] = p.schema as string;
      return apiRequest(ctx, "GET", p.table, undefined, qs, headers);
    },
  });

  rl.registerAction("row.update", {
    access: "write",
    description: "Update rows matching a filter",
    inputSchema: {
      table: { type: "string", required: true },
      data: { type: "object", required: true, description: "Fields to update" },
      filters: {
        type: "object",
        required: true,
        description: "PostgREST filters to match rows",
      },
      schema: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const headers: Record<string, string> = {};
      if (p.schema && p.schema !== "public")
        headers["Content-Profile"] = p.schema as string;
      return apiRequest(
        ctx,
        "PATCH",
        p.table,
        p.data,
        p.filters as Record<string, unknown>,
        headers,
      );
    },
  });

  rl.registerAction("row.delete", {
    access: "write",
    description: "Delete rows matching a filter",
    inputSchema: {
      table: { type: "string", required: true },
      filters: {
        type: "object",
        required: true,
        description: "PostgREST filters to match rows",
      },
      schema: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const headers: Record<string, string> = {};
      if (p.schema && p.schema !== "public")
        headers["Content-Profile"] = p.schema as string;
      return apiRequest(
        ctx,
        "DELETE",
        p.table,
        undefined,
        p.filters as Record<string, unknown>,
        headers,
      );
    },
  });
}
