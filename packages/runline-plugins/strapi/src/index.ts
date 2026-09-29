import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import { strapiCredential, strapiVersion } from "./credentials.js";

/** Whether the connection speaks Strapi v4, whose answers wrap entries in `data`. */
function isV4(ctx: ActionContext): boolean {
  return strapiVersion(ctx.connection.config) === "v4";
}

/** A content API call; GET and DELETE carry no body. */
function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, strapiCredential, "strapi", {
    target: "api",
    path,
    method,
    query,
    ...(body && method !== "GET" && method !== "DELETE" ? { json: body } : {}),
  });
}

/** An entry, or a content type's collection, as a path beneath the API. */
function entryPath(contentType: unknown, entryId?: unknown): string {
  return entryId === undefined
    ? pathSegment(contentType)
    : `${pathSegment(contentType)}/${pathSegment(entryId)}`;
}

export default function strapi(rl: RunlinePluginAPI) {
  rl.setName("strapi");
  rl.setVersion("0.1.0");
  rl.setCredential(strapiCredential);

  rl.setConnectionSchema({
    url: {
      type: "string",
      required: true,
      description: "Strapi base URL",
      env: "STRAPI_URL",
    },
    apiVersion: {
      type: "string",
      required: false,
      description: "v3 or v4 (default: v4)",
      env: "STRAPI_API_VERSION",
    },
    authMethod: {
      type: "string",
      required: false,
      description:
        "apiToken or password (inferred from which credential the connection holds)",
      env: "STRAPI_AUTH_METHOD",
    },
    apiToken: {
      type: "string",
      required: false,
      description: "Strapi API token (preferred)",
      env: "STRAPI_API_TOKEN",
    },
    email: {
      type: "string",
      required: false,
      description: "Email for password auth",
      env: "STRAPI_EMAIL",
    },
    password: {
      type: "string",
      required: false,
      description: "Password for password auth",
      env: "STRAPI_PASSWORD",
    },
  });

  rl.registerAction("entry.create", {
    access: "write",
    description: "Create an entry in a content type",
    inputSchema: {
      contentType: {
        type: "string",
        required: true,
        description: "Content type plural name (e.g. articles)",
      },
      data: { type: "object", required: true, description: "Entry fields" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body = isV4(ctx)
        ? { data: p.data }
        : (p.data as Record<string, unknown>);
      return apiRequest(ctx, "POST", entryPath(p.contentType), body);
    },
  });

  rl.registerAction("entry.get", {
    access: "read",
    description: "Get an entry by ID",
    inputSchema: {
      contentType: { type: "string", required: true },
      entryId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const data = (await apiRequest(
        ctx,
        "GET",
        entryPath(p.contentType, p.entryId),
      )) as Record<string, unknown>;
      return isV4(ctx) ? data.data : data;
    },
  });

  rl.registerAction("entry.list", {
    access: "read",
    description: "List entries of a content type",
    inputSchema: {
      contentType: { type: "string", required: true },
      limit: { type: "number", required: false },
      sort: {
        type: "string",
        required: false,
        description: "Comma-separated sort fields",
      },
      filters: {
        type: "string",
        required: false,
        description: "JSON filter object",
      },
      publicationState: {
        type: "string",
        required: false,
        description: "live or preview",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (isV4(ctx)) {
        if (p.limit) qs["pagination[pageSize]"] = p.limit;
        if (p.sort) qs.sort = p.sort;
        if (p.filters) qs.filters = p.filters;
        if (p.publicationState) qs.publicationState = p.publicationState;
        const data = (await apiRequest(
          ctx,
          "GET",
          entryPath(p.contentType),
          undefined,
          qs,
        )) as Record<string, unknown>;
        return data.data;
      }
      if (p.limit) qs._limit = p.limit;
      if (p.sort) qs._sort = p.sort;
      if (p.filters) qs._where = p.filters;
      if (p.publicationState) qs._publicationState = p.publicationState;
      return apiRequest(ctx, "GET", entryPath(p.contentType), undefined, qs);
    },
  });

  rl.registerAction("entry.update", {
    access: "write",
    description: "Update an entry by ID",
    inputSchema: {
      contentType: { type: "string", required: true },
      entryId: { type: "string", required: true },
      data: { type: "object", required: true, description: "Fields to update" },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body = isV4(ctx)
        ? { data: p.data }
        : (p.data as Record<string, unknown>);
      const result = (await apiRequest(
        ctx,
        "PUT",
        entryPath(p.contentType, p.entryId),
        body,
      )) as Record<string, unknown>;
      return isV4(ctx) ? result.data : result;
    },
  });

  rl.registerAction("entry.delete", {
    access: "write",
    description: "Delete an entry by ID",
    inputSchema: {
      contentType: { type: "string", required: true },
      entryId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return apiRequest(ctx, "DELETE", entryPath(p.contentType, p.entryId));
    },
  });
}
