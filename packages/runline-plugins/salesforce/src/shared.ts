import type { ActionContext } from "runline";

export const DEFAULT_API_VERSION = "v59.0";

export type Ctx = {
  connection: { config: Record<string, unknown> };
} & Partial<ActionContext>;

type MaybePromise<T> = T | Promise<T>;

export type SalesforceConn = {
  instanceUrl?: string;
  accessToken?: string;
  loginUrl?: string;
  clientId?: string;
  clientSecret?: string;
  apiVersion?: string;
};

export type SalesforceSession = {
  instanceUrl: string;
  accessToken: string;
  tokenType?: string;
  scope?: string;
  id?: string;
  issuedAt?: string;
};

export function config(ctx: Ctx): SalesforceConn {
  return ctx.connection.config as SalesforceConn;
}

export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Salesforce connection is missing ${name}`);
  }
  return value.trim();
}

export function apiVersion(ctx: Ctx): string {
  const raw = config(ctx).apiVersion;
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_API_VERSION;
  const version = raw.trim();
  return version.startsWith("v") ? version : `v${version}`;
}

export function validateInstanceUrl(url: string): string {
  const normalized = trimTrailingSlash(url.trim());
  if (/\.lightning\.force\.com$/i.test(new URL(normalized).hostname)) {
    throw new Error(
      "Salesforce instanceUrl/loginUrl must be the API My Domain URL, not the Lightning UI URL. Use a URL like https://your-domain.my.salesforce.com.",
    );
  }
  return normalized;
}

export async function getSession(ctx: Ctx): Promise<SalesforceSession> {
  const c = config(ctx);
  if (c.accessToken) {
    return {
      instanceUrl: validateInstanceUrl(requireString(c.instanceUrl, "instanceUrl")),
      accessToken: requireString(c.accessToken, "accessToken"),
      tokenType: "Bearer",
    };
  }

  const loginUrl = validateInstanceUrl(
    requireString(c.loginUrl ?? c.instanceUrl, "loginUrl or instanceUrl"),
  );
  const clientId = requireString(c.clientId, "clientId");
  const clientSecret = requireString(c.clientSecret, "clientSecret");

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);

  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = typeof data.error === "string" ? data.error : res.status;
    const description =
      typeof data.error_description === "string"
        ? `: ${data.error_description}`
        : "";
    throw new Error(`Salesforce token error ${err}${description}`);
  }

  return {
    instanceUrl: validateInstanceUrl(
      requireString(data.instance_url, "token response instance_url"),
    ),
    accessToken: requireString(
      data.access_token,
      "token response access_token",
    ),
    tokenType: typeof data.token_type === "string" ? data.token_type : "Bearer",
    scope: typeof data.scope === "string" ? data.scope : undefined,
    id: typeof data.id === "string" ? data.id : undefined,
    issuedAt: typeof data.issued_at === "string" ? data.issued_at : undefined,
  };
}

export async function api(
  ctx: Ctx,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
  session: MaybePromise<SalesforceSession> = getSession(ctx),
): Promise<unknown> {
  return rest(
    ctx,
    method,
    `/services/data/${apiVersion(ctx)}${endpoint}`,
    body,
    qs,
    session,
  );
}

export async function rest(
  ctx: Ctx,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  qs?: Record<string, unknown>,
  session: MaybePromise<SalesforceSession> = getSession(ctx),
): Promise<unknown> {
  const resolvedSession = await session;
  const url = new URL(path, resolvedSession.instanceUrl);
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${resolvedSession.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  };
  if (body && Object.keys(body).length > 0) init.body = JSON.stringify(body);
  const res = await fetch(url.toString(), init);
  if (res.status === 204) return { success: true };
  const text = await res.text();
  if (!res.ok) throw new Error(`Salesforce error ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

export async function identity(ctx: Ctx): Promise<Record<string, unknown>> {
  const session = await getSession(ctx);
  if (!session.id) {
    return { instanceUrl: session.instanceUrl, tokenType: session.tokenType };
  }
  const res = await fetch(session.id, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Salesforce identity error ${res.status}: ${text}`);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}
