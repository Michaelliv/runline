import type { ActionContext, HttpMethod, RunlinePluginAPI } from "runline";
import { credentialRequest } from "../../_shared/credentials.js";
import { oktaCredential } from "./credentials.js";

/** An ID or login as one path segment. */
const seg = (value: unknown) => encodeURIComponent(String(value));

async function apiRequest(
  ctx: ActionContext,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<{ data: unknown; linkHeader?: string }> {
  const res = await credentialRequest(ctx, oktaCredential, {
    target: "api",
    path,
    method,
    query: qs,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
  if (!res.ok) throw new Error(`okta: request failed (HTTP ${res.status})`);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  return { data, linkHeader: res.headers.get("link") ?? undefined };
}

async function paginate(
  ctx: ActionContext,
  path: string,
  qs: Record<string, unknown> = {},
): Promise<unknown[]> {
  const all: unknown[] = [];
  let after: string | undefined;
  do {
    if (after) qs.after = after;
    qs.limit = 200;
    const { data, linkHeader } = await apiRequest(
      ctx,
      "GET",
      path,
      undefined,
      qs,
    );
    const items = Array.isArray(data) ? data : [];
    all.push(...items);
    after = undefined;
    if (linkHeader) {
      const match = linkHeader.match(/after=([^&>]+)/);
      if (match) after = match[1];
    }
  } while (after);
  return all;
}

export default function okta(rl: RunlinePluginAPI) {
  rl.setName("okta");
  rl.setVersion("0.1.0");
  rl.setCredential(oktaCredential);

  rl.setConnectionSchema({
    url: {
      type: "string",
      required: true,
      description: "Okta org URL (e.g. https://yourorg.okta.com)",
      env: "OKTA_URL",
    },
    apiToken: {
      type: "string",
      required: true,
      description: "Okta API token (SSWS)",
      env: "OKTA_API_TOKEN",
    },
  });

  rl.registerAction("user.create", {
    access: "write",
    description: "Create a new user in Okta",
    inputSchema: {
      firstName: { type: "string", required: true },
      lastName: { type: "string", required: true },
      login: {
        type: "string",
        required: true,
        description: "Username (must be email)",
      },
      email: { type: "string", required: true },
      activate: {
        type: "boolean",
        required: false,
        description: "Activate user immediately (default true)",
      },
      password: { type: "string", required: false },
      profile: {
        type: "object",
        required: false,
        description:
          "Additional profile fields (city, department, displayName, etc.)",
      },
    },
    async execute(input, ctx) {
      const p = input as Record<string, unknown>;
      const body: Record<string, unknown> = {
        profile: {
          firstName: p.firstName,
          lastName: p.lastName,
          login: p.login,
          email: p.email,
          ...((p.profile as Record<string, unknown>) ?? {}),
        },
      };
      if (p.password) {
        body.credentials = { password: { value: p.password } };
      }
      const qs: Record<string, unknown> = {
        activate: p.activate !== false ? "true" : "false",
      };
      const { data } = await apiRequest(ctx, "POST", "users/", body, qs);
      return data;
    },
  });

  rl.registerAction("user.get", {
    access: "read",
    description: "Get user details by ID or login",
    inputSchema: {
      userId: {
        type: "string",
        required: true,
        description: "User ID or login (email)",
      },
    },
    async execute(input, ctx) {
      const { userId } = input as Record<string, unknown>;
      const { data } = await apiRequest(ctx, "GET", `users/${seg(userId)}`);
      return data;
    },
  });

  rl.registerAction("user.list", {
    access: "read",
    description: "List users (with optional search query)",
    inputSchema: {
      search: {
        type: "string",
        required: false,
        description: 'Search/filter query, e.g. profile.lastName sw "Smi"',
      },
      limit: {
        type: "number",
        required: false,
        description: "Max results (default all)",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (p.search) qs.search = p.search;
      if (p.limit) {
        qs.limit = p.limit;
        const { data } = await apiRequest(ctx, "GET", "users/", undefined, qs);
        return data;
      }
      return paginate(ctx, "users/", qs);
    },
  });

  rl.registerAction("user.update", {
    access: "write",
    description: "Update a user's profile",
    inputSchema: {
      userId: { type: "string", required: true, description: "User ID" },
      profile: {
        type: "object",
        required: true,
        description:
          "Profile fields to update (firstName, lastName, email, login, city, department, etc.)",
      },
    },
    async execute(input, ctx) {
      const { userId, profile } = input as Record<string, unknown>;
      const { data } = await apiRequest(ctx, "POST", `users/${seg(userId)}`, {
        profile,
      });
      return data;
    },
  });

  rl.registerAction("user.delete", {
    access: "write",
    description: "Delete (deactivate and then delete) a user",
    inputSchema: {
      userId: { type: "string", required: true, description: "User ID" },
    },
    async execute(input, ctx) {
      const { userId } = input as Record<string, unknown>;
      await apiRequest(ctx, "DELETE", `users/${seg(userId)}`);
      return { success: true };
    },
  });
}
