import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { mailerliteCredential } from "./credentials.js";

function api(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, mailerliteCredential, "mailerlite", {
    target: "api",
    path,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 && method !== "GET"
      ? { json: body }
      : {}),
  });
}

async function paginateAll(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  qs.limit = 1000;
  let cursor: string | null = null;
  do {
    if (cursor) qs.cursor = cursor;
    const resp = (await api(ctx, method, endpoint, undefined, qs)) as Record<
      string,
      unknown
    >;
    const data = resp.data as unknown[];
    if (data) all.push(...data);
    const meta = resp.meta as Record<string, unknown> | undefined;
    const links = resp.links as Record<string, unknown> | undefined;
    cursor = (meta?.next_cursor as string) ?? null;
    if (!links?.next) cursor = null;
  } while (cursor);
  return all;
}

export default function mailerlite(rl: RunlinePluginAPI) {
  rl.setName("mailerlite");
  rl.setVersion("0.1.0");
  rl.setCredential(mailerliteCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "MailerLite API token",
      env: "MAILERLITE_API_KEY",
    },
  });

  rl.registerAction("subscriber.create", {
    access: "write",
    description: "Create a subscriber",
    inputSchema: {
      email: { type: "string", required: true },
      fields: {
        type: "object",
        required: false,
        description: "Custom fields as {field_key: value}",
      },
      groups: {
        type: "array",
        required: false,
        description: "Array of group IDs",
      },
      status: {
        type: "string",
        required: false,
        description: "active, unsubscribed, unconfirmed, bounced, junk",
      },
      subscribed_at: {
        type: "string",
        required: false,
        description: "ISO datetime",
      },
      ip_address: { type: "string", required: false },
      opted_in_at: { type: "string", required: false },
      optin_ip: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { email, fields, ...rest } = input as Record<string, unknown>;
      const body: Record<string, unknown> = { email };
      if (fields) body.fields = fields;
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined && v !== null) body[k] = v;
      }
      const resp = (await api(ctx, "POST", "subscribers", body)) as Record<
        string,
        unknown
      >;
      return resp.data;
    },
  });

  rl.registerAction("subscriber.get", {
    access: "read",
    description: "Get a subscriber by ID or email",
    inputSchema: {
      subscriberId: {
        type: "string",
        required: true,
        description: "Subscriber ID or email",
      },
    },
    async execute(input, ctx) {
      const resp = (await api(
        ctx,
        "GET",
        `subscribers/${encodeURIComponent((input as { subscriberId: string }).subscriberId)}`,
      )) as Record<string, unknown>;
      return resp.data;
    },
  });

  rl.registerAction("subscriber.list", {
    access: "read",
    description: "List subscribers",
    inputSchema: {
      limit: { type: "number", required: false },
      status: {
        type: "string",
        required: false,
        description:
          "Filter by status: active, unsubscribed, unconfirmed, bounced, junk",
      },
    },
    async execute(input, ctx) {
      const { limit, status } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (status) qs["filter[status]"] = status;
      if (limit) {
        qs.limit = limit;
        const resp = (await api(
          ctx,
          "GET",
          "subscribers",
          undefined,
          qs,
        )) as Record<string, unknown>;
        return resp.data;
      }
      return paginateAll(ctx, "GET", "subscribers", qs);
    },
  });

  rl.registerAction("subscriber.update", {
    access: "write",
    description: "Update a subscriber",
    inputSchema: {
      subscriberId: {
        type: "string",
        required: true,
        description: "Subscriber ID or email",
      },
      fields: {
        type: "object",
        required: false,
        description: "Custom fields as {field_key: value}",
      },
      groups: {
        type: "array",
        required: false,
        description: "Array of group IDs",
      },
      status: { type: "string", required: false },
      subscribed_at: { type: "string", required: false },
      ip_address: { type: "string", required: false },
      opted_in_at: { type: "string", required: false },
      optin_ip: { type: "string", required: false },
    },
    async execute(input, ctx) {
      const { subscriberId, fields, ...rest } = input as Record<
        string,
        unknown
      >;
      const body: Record<string, unknown> = {};
      if (fields) body.fields = fields;
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined && v !== null && k !== "subscriberId") body[k] = v;
      }
      return api(
        ctx,
        "PUT",
        `subscribers/${encodeURIComponent(subscriberId as string)}`,
        body,
      );
    },
  });
}
