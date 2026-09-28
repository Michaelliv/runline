import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { zammadCredential } from "./credentials.js";

/** An ID as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

async function api(
  ctx: ActionContext,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, zammadCredential, "zammad", {
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
      return api(ctx, "POST", plural, input as Record<string, unknown>);
    },
  });

  rl.registerAction(`${resource}.get`, {
    access: "read",
    description: `Get a ${resource} by ID`,
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      return api(
        ctx,
        "GET",
        `${plural}/${seg((input as Record<string, unknown>).id)}`,
      );
    },
  });

  rl.registerAction(`${resource}.list`, {
    access: "read",
    description: `List ${plural}`,
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = { per_page: p.limit ?? 100 };
      return api(ctx, "GET", plural, undefined, qs);
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
      return api(
        ctx,
        "PUT",
        `${plural}/${seg(p.id)}`,
        p.data as Record<string, unknown>,
      );
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

export default function zammad(rl: RunlinePluginAPI) {
  rl.setName("zammad");
  rl.setVersion("0.1.0");
  rl.setCredential(zammadCredential);
  rl.setConnectionSchema({
    url: {
      type: "string",
      required: true,
      description: "Zammad instance URL",
      env: "ZAMMAD_URL",
    },
    token: {
      type: "string",
      required: true,
      description: "Zammad access token",
      env: "ZAMMAD_TOKEN",
    },
  });

  registerCrud(rl, "user", "users", {
    firstname: { type: "string", required: true },
    lastname: { type: "string", required: true },
    email: { type: "string", required: false },
  });
  registerCrud(rl, "organization", "organizations", {
    name: { type: "string", required: true },
  });
  registerCrud(rl, "group", "groups", {
    name: { type: "string", required: true },
  });

  // ── Ticket (special: includes article) ──────────────

  rl.registerAction("ticket.create", {
    access: "write",
    description: "Create a ticket",
    inputSchema: {
      title: { type: "string", required: true },
      group: { type: "string", required: true },
      customer: {
        type: "string",
        required: true,
        description: "Customer email",
      },
      articleBody: { type: "string", required: true },
      articleSubject: { type: "string", required: false },
      articleInternal: { type: "boolean", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        title: p.title,
        group: p.group,
        customer: p.customer,
        article: { body: p.articleBody, internal: p.articleInternal ?? false },
      };
      if (p.articleSubject)
        (body.article as Record<string, unknown>).subject = p.articleSubject;
      return api(ctx, "POST", "tickets", body);
    },
  });

  rl.registerAction("ticket.get", {
    access: "read",
    description: "Get a ticket with articles",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      const id = (input as Record<string, unknown>).id;
      const ticket = (await api(ctx, "GET", `tickets/${seg(id)}`)) as Record<
        string,
        unknown
      >;
      ticket.articles = await api(
        ctx,
        "GET",
        `ticket_articles/by_ticket/${seg(id)}`,
      );
      return ticket;
    },
  });

  rl.registerAction("ticket.list", {
    access: "read",
    description: "List tickets",
    inputSchema: { limit: { type: "number", required: false } },
    async execute(input, ctx) {
      const qs: Record<string, unknown> = {
        per_page: ((input ?? {}) as Record<string, unknown>).limit ?? 100,
      };
      return api(ctx, "GET", "tickets", undefined, qs);
    },
  });

  rl.registerAction("ticket.update", {
    access: "write",
    description: "Update a ticket",
    inputSchema: {
      id: { type: "string", required: true },
      data: { type: "object", required: true },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      return api(
        ctx,
        "PUT",
        `tickets/${seg(p.id)}`,
        p.data as Record<string, unknown>,
      );
    },
  });

  rl.registerAction("ticket.delete", {
    access: "write",
    description: "Delete a ticket",
    inputSchema: { id: { type: "string", required: true } },
    async execute(input, ctx) {
      await api(
        ctx,
        "DELETE",
        `tickets/${seg((input as Record<string, unknown>).id)}`,
      );
      return { success: true };
    },
  });

  // ── User extras ─────────────────────────────────────

  rl.registerAction("user.getSelf", {
    access: "read",
    description: "Get the current user",
    inputSchema: {},
    async execute(_input, ctx) {
      return api(ctx, "GET", "users/me");
    },
  });

  rl.registerAction("user.search", {
    access: "read",
    description: "Search users",
    inputSchema: {
      query: { type: "string", required: true },
      limit: { type: "number", required: false },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const qs: Record<string, unknown> = { query: p.query };
      if (p.limit) qs.per_page = p.limit;
      return api(ctx, "GET", "users/search", undefined, qs);
    },
  });
}
