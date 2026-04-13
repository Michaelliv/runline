import type { RunlinePluginAPI } from "runline";

function getConn(ctx: { connection: { config: Record<string, unknown> } }) {
  const c = ctx.connection.config;
  return {
    url: (c.url as string).replace(/\/$/, ""),
    apiVersion: (c.apiVersion as string) || "v4",
    apiToken: c.apiToken as string | undefined,
    email: c.email as string | undefined,
    password: c.password as string | undefined,
  };
}

let cachedJwt: { token: string; url: string; expiry: number } | undefined;

async function getJwt(conn: { url: string; apiVersion: string; email?: string; password?: string }): Promise<string> {
  if (cachedJwt && cachedJwt.url === conn.url && Date.now() < cachedJwt.expiry) return cachedJwt.token;
  const authPath = conn.apiVersion === "v4" ? "/api/auth/local" : "/auth/local";
  const res = await fetch(`${conn.url}${authPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: conn.email, password: conn.password }),
  });
  if (!res.ok) throw new Error(`Strapi auth error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as Record<string, unknown>;
  const jwt = data.jwt as string;
  cachedJwt = { token: jwt, url: conn.url, expiry: Date.now() + 3600_000 };
  return jwt;
}

async function apiRequest(
  conn: ReturnType<typeof getConn>, method: string, endpoint: string,
  body?: Record<string, unknown>, qs?: Record<string, unknown>,
): Promise<unknown> {
  let token: string;
  if (conn.apiToken) {
    token = conn.apiToken;
  } else {
    token = await getJwt(conn);
  }
  const prefix = conn.apiVersion === "v4" ? "/api" : "";
  const url = new URL(`${conn.url}${prefix}${endpoint}`);
  if (qs) { for (const [k, v] of Object.entries(qs)) { if (v !== undefined && v !== null) url.searchParams.set(k, String(v)); } }
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (!res.ok) throw new Error(`Strapi error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export default function strapi(rl: RunlinePluginAPI) {
  rl.setName("strapi");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    url: { type: "string", required: true, description: "Strapi base URL", env: "STRAPI_URL" },
    apiVersion: { type: "string", required: false, description: "v3 or v4 (default: v4)", env: "STRAPI_API_VERSION" },
    apiToken: { type: "string", required: false, description: "Strapi API token (preferred)", env: "STRAPI_API_TOKEN" },
    email: { type: "string", required: false, description: "Email for password auth", env: "STRAPI_EMAIL" },
    password: { type: "string", required: false, description: "Password for password auth", env: "STRAPI_PASSWORD" },
  });

  rl.registerAction("entry.create", {
    description: "Create an entry in a content type",
    inputSchema: {
      contentType: { type: "string", required: true, description: "Content type plural name (e.g. articles)" },
      data: { type: "object", required: true, description: "Entry fields" },
    },
    async execute(input, ctx) {
      const conn = getConn(ctx);
      const p = input as Record<string, unknown>;
      const body = conn.apiVersion === "v4" ? { data: p.data } : p.data as Record<string, unknown>;
      return apiRequest(conn, "POST", `/${p.contentType}`, body);
    },
  });

  rl.registerAction("entry.get", {
    description: "Get an entry by ID",
    inputSchema: {
      contentType: { type: "string", required: true },
      entryId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const conn = getConn(ctx);
      const p = input as Record<string, unknown>;
      const data = (await apiRequest(conn, "GET", `/${p.contentType}/${p.entryId}`)) as Record<string, unknown>;
      return conn.apiVersion === "v4" ? data.data : data;
    },
  });

  rl.registerAction("entry.list", {
    description: "List entries of a content type",
    inputSchema: {
      contentType: { type: "string", required: true },
      limit: { type: "number", required: false },
      sort: { type: "string", required: false, description: "Comma-separated sort fields" },
      filters: { type: "string", required: false, description: "JSON filter object" },
      publicationState: { type: "string", required: false, description: "live or preview" },
    },
    async execute(input, ctx) {
      const conn = getConn(ctx);
      const p = (input ?? {}) as Record<string, unknown>;
      const qs: Record<string, unknown> = {};
      if (conn.apiVersion === "v4") {
        if (p.limit) qs["pagination[pageSize]"] = p.limit;
        if (p.sort) qs.sort = p.sort;
        if (p.filters) qs.filters = p.filters;
        if (p.publicationState) qs.publicationState = p.publicationState;
        const data = (await apiRequest(conn, "GET", `/${p.contentType}`, undefined, qs)) as Record<string, unknown>;
        return data.data;
      }
      if (p.limit) qs._limit = p.limit;
      if (p.sort) qs._sort = p.sort;
      if (p.filters) qs._where = p.filters;
      if (p.publicationState) qs._publicationState = p.publicationState;
      return apiRequest(conn, "GET", `/${p.contentType}`, undefined, qs);
    },
  });

  rl.registerAction("entry.update", {
    description: "Update an entry by ID",
    inputSchema: {
      contentType: { type: "string", required: true },
      entryId: { type: "string", required: true },
      data: { type: "object", required: true, description: "Fields to update" },
    },
    async execute(input, ctx) {
      const conn = getConn(ctx);
      const p = input as Record<string, unknown>;
      const body = conn.apiVersion === "v4" ? { data: p.data } : p.data as Record<string, unknown>;
      const result = (await apiRequest(conn, "PUT", `/${p.contentType}/${p.entryId}`, body)) as Record<string, unknown>;
      return conn.apiVersion === "v4" ? result.data : result;
    },
  });

  rl.registerAction("entry.delete", {
    description: "Delete an entry by ID",
    inputSchema: {
      contentType: { type: "string", required: true },
      entryId: { type: "string", required: true },
    },
    async execute(input, ctx) {
      const conn = getConn(ctx);
      const p = input as Record<string, unknown>;
      return apiRequest(conn, "DELETE", `/${p.contentType}/${p.entryId}`);
    },
  });
}
