import {
  AuthError,
  downloadResource,
  type ActionContext,
  type HttpMethod,
} from "runline";
import { credentialRuntime } from "./credentialAdapter.js";
import {
  microsoftCredentialType,
  microsoftMethod,
  microsoftUserBase,
  type MicrosoftAuthConfig,
} from "./microsoftCredentials.js";

export type { MicrosoftAuthConfig } from "./microsoftCredentials.js";
export { microsoftDriveBase } from "./microsoftCredentials.js";

export function isAppOnly(cfg: MicrosoftAuthConfig): boolean {
  return microsoftMethod(cfg) === "appOnly";
}

export function userBase(ctx: ActionContext): string {
  return microsoftUserBase(ctx.connection.config as MicrosoftAuthConfig);
}

function runtime(ctx: ActionContext, plugin: string, scopes: string[]) {
  const cfg = ctx.connection.config as MicrosoftAuthConfig;
  const method = microsoftMethod(cfg);
  if (
    method === "appOnly" &&
    (!cfg.tenantId ||
      ["common", "organizations", "consumers"].includes(cfg.tenantId))
  )
    throw new AuthError("invalid_credentials");
  return credentialRuntime(
    ctx,
    microsoftCredentialType(cfg, plugin, scopes),
    method,
    (current) => {
      const c = current as MicrosoftAuthConfig;
      return [
        microsoftMethod(c),
        c.tenantId,
        c.clientId,
        c.clientSecret,
        scopes,
      ];
    },
  );
}

/** Compatibility token access uses the same grant runtime as resource requests. */
export async function microsoftAccessToken(
  ctx: ActionContext,
  plugin: string,
  scopes: string[],
): Promise<string> {
  const { binding, transport } = runtime(ctx, plugin, scopes);
  return transport.accessToken(binding);
}

export async function microsoftProbe(
  ctx: ActionContext,
  plugin: string,
  scopes: string[],
) {
  const { binding, transport } = runtime(ctx, plugin, scopes);
  return transport.probe(binding);
}

export async function graphResponse(
  ctx: ActionContext,
  plugin: string,
  scopes: string[],
  method: string,
  path: string,
  body?: string | Uint8Array,
  contentType?: string,
): Promise<Response> {
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new AuthError("request_not_allowed");
  const { binding, transport } = runtime(ctx, plugin, scopes);
  return transport.request(binding, {
    target: "graph",
    path: path.slice(1),
    method: method as HttpMethod,
    headers: {
      Accept: "application/json",
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body,
  });
}

/** JSON and binary requests share the same destination, renewal and replay policy. */
export async function graphRequest(
  ctx: ActionContext,
  plugin: string,
  scopes: string[],
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const res = await graphResponse(
    ctx,
    plugin,
    scopes,
    method,
    path,
    body === undefined ? undefined : JSON.stringify(body),
    body === undefined ? undefined : "application/json",
  );
  if (!res.ok)
    throw new Error(`${plugin}: Graph request failed (HTTP ${res.status})`);
  if (res.status === 204) return { success: true };
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : { success: true };
  } catch {
    throw new Error(`${plugin}: invalid Graph response`);
  }
}

/** Graph-issued signed download URLs carry their own authority, never a bearer header. */
export async function microsoftDownload(value: unknown): Promise<Response> {
  if (typeof value !== "string") throw new AuthError("invalid_response");
  let url: URL;
  try {
    url = new URL(value);
    const domains = [
      "sharepoint.com",
      "1drv.com",
      "storage.live.com",
      "onedrive.com",
    ];
    if (
      url.port ||
      !domains.some(
        (domain) =>
          url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      )
    )
      throw new Error();
  } catch {
    throw new AuthError("request_not_allowed");
  }
  return downloadResource(value, {
    allowedOrigins: [url.origin],
    fetch: globalThis.fetch,
  });
}

/** Setup help shown by the OAuth wizard for all Microsoft plugins. */
export function microsoftSetupHelp(apiName: string): string[] {
  return [
    `You need a Microsoft Entra (Azure AD) app registration. One-time, ~5 minutes.`,
    "",
    "1. Register an app: https://entra.microsoft.com → App registrations → New registration.",
    "   Supported account types: your org (single tenant) is fine.",
    "2. Add a Web redirect URI (Authentication → Add platform → Web):",
    "     {{redirectUri}}",
    "3. Certificates & secrets → New client secret → copy the VALUE (not the Secret ID).",
    `4. API permissions → Add → Microsoft Graph → Delegated → add the ${apiName} scopes,`,
    "   then 'Grant admin consent'.",
    "5. Paste the Application (client) ID and the client secret VALUE below.",
  ];
}
