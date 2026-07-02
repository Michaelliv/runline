import type { RunlinePluginAPI } from "runline";

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(
  authUrl: string,
  clientId: string,
  clientSecret: string,
  scope: string,
  tenant?: string,
): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt)
    return cachedToken.token;
  const url = tenant ? `${authUrl}?tenant=${tenant}` : authUrl;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok)
    throw new Error(`HaloPSA auth error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as Record<string, unknown>;
  cachedToken = {
    token: data.access_token as string,
    expiresAt: Date.now() + ((data.expires_in as number) - 60) * 1000,
  };
  return cachedToken.token;
}

async function apiRequest(
  apiUrl: string,
  token: string,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${apiUrl}${endpoint}`);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };
  if (
    body &&
    Object.keys(body).length > 0 &&
    method !== "GET" &&
    method !== "DELETE"
  )
    opts.body = JSON.stringify(body);
  const res = await fetch(url.toString(), opts);
  if (!res.ok)
    throw new Error(`HaloPSA API error ${res.status}: ${await res.text()}`);
  if (res.status === 204) return { success: true };
  return res.json();
}

async function req(
  ctx: { connection: { config: Record<string, unknown> } },
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
) {
  const cfg = ctx.connection.config;
  const authUrl =
    cfg.hostingType === "on-premise"
      ? `${cfg.appUrl}/auth/token`
      : `${cfg.authUrl}/token`;
  const token = await getToken(
    authUrl,
    cfg.clientId as string,
    cfg.clientSecret as string,
    (cfg.scope as string) ?? "all",
    cfg.tenant as string | undefined,
  );
  return apiRequest(
    (cfg.resourceApiUrl as string).replace(/\/$/, ""),
    token,
    method,
    endpoint,
    body,
    qs,
  );
}

function registerCrud(rl: RunlinePluginAPI, resource: string, apiPath: string) {
  rl.registerAction(`${resource}.create`, {
    access: "write",
    description: `Create a ${resource}`,
    inputSchema: {
      properties: {
        type: "object",
        required: true,
        description: `${resource} data`,
      },
    },
    async execute(input, ctx) {
      return req(ctx, "POST", apiPath, {
        ...(input as { properties: Record<string, unknown> }).properties,
      });
    },
  });
  rl.registerAction(`${resource}.get`, {
    access: "read",
    description: `Get a ${resource}`,
    inputSchema: {
      id: { type: "number", required: true, description: `${resource} ID` },
    },
    async execute(input, ctx) {
      return req(ctx, "GET", `${apiPath}/${(input as { id: number }).id}`);
    },
  });
  rl.registerAction(`${resource}.list`, {
    access: "read",
    description: `List ${resource}s`,
    inputSchema: {
      limit: { type: "number", required: false, description: "Max results" },
      page: { type: "number", required: false, description: "Page" },
    },
    async execute(input, ctx) {
      const { limit, page } = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (limit) qs.count = limit;
      if (page) qs.page_no = page;
      return req(ctx, "GET", apiPath, undefined, qs);
    },
  });
  rl.registerAction(`${resource}.update`, {
    access: "write",
    description: `Update a ${resource}`,
    inputSchema: {
      id: { type: "number", required: true, description: `${resource} ID` },
      properties: {
        type: "object",
        required: true,
        description: "Fields to update",
      },
    },
    async execute(input, ctx) {
      const { id, properties } = input as {
        id: number;
        properties: Record<string, unknown>;
      };
      return req(ctx, "PUT", apiPath, { id, ...properties });
    },
  });
  rl.registerAction(`${resource}.delete`, {
    access: "write",
    description: `Delete a ${resource}`,
    inputSchema: {
      id: { type: "number", required: true, description: `${resource} ID` },
    },
    async execute(input, ctx) {
      await req(ctx, "DELETE", `${apiPath}/${(input as { id: number }).id}`);
      return { success: true };
    },
  });
}

export default function halopsa(rl: RunlinePluginAPI) {
  rl.setName("halopsa");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    hostingType: {
      type: "string",
      required: false,
      description: "cloud (default) or on-premise",
      default: "cloud",
    },
    authUrl: {
      type: "string",
      required: false,
      description: "Auth server URL (cloud)",
      env: "HALOPSA_AUTH_URL",
    },
    appUrl: {
      type: "string",
      required: false,
      description: "App URL (on-premise)",
      env: "HALOPSA_APP_URL",
    },
    resourceApiUrl: {
      type: "string",
      required: true,
      description: "Resource API URL",
      env: "HALOPSA_API_URL",
    },
    clientId: {
      type: "string",
      required: true,
      description: "OAuth2 client ID",
      env: "HALOPSA_CLIENT_ID",
    },
    clientSecret: {
      type: "string",
      required: true,
      description: "OAuth2 client secret",
      env: "HALOPSA_CLIENT_SECRET",
    },
    scope: {
      type: "string",
      required: false,
      description: "OAuth2 scope (default: all)",
      default: "all",
    },
    tenant: {
      type: "string",
      required: false,
      description: "Tenant (cloud only)",
    },
  });

  registerCrud(rl, "client", "/client");
  registerCrud(rl, "site", "/site");
  registerCrud(rl, "ticket", "/tickets");
  registerCrud(rl, "user", "/users");
}
