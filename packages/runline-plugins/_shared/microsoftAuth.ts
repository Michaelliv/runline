import type { ActionContext } from "runline";

const REFRESH_SKEW_MS = 60_000;

/**
 * Shared auth for the Microsoft Graph plugins (mail, calendar, files).
 *
 * Two modes, auto-detected from the connection config:
 *
 *  - Delegated (OAuth2): the connection has clientId/clientSecret/refreshToken
 *    (seeded by Vex's OAuth wizard). Acts as the signed-in user; use /me paths.
 *  - App-only (client credentials): the connection has tenantId/clientId/
 *    clientSecret but no refreshToken. Acts as the application; target a mailbox/
 *    drive with userUpn → /users/{upn} paths.
 *
 * Tokens are cached in the connection (accessToken + accessTokenExpiresAt) via
 * ctx.updateConnection, matching the Google plugins' pattern.
 */
export type MicrosoftAuthConfig = {
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  userUpn?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
};

function authority(cfg: MicrosoftAuthConfig): string {
  return `https://login.microsoftonline.com/${cfg.tenantId || "common"}/oauth2/v2.0/token`;
}

export function isAppOnly(cfg: MicrosoftAuthConfig): boolean {
  return !cfg.refreshToken && !!(cfg.tenantId && cfg.clientId && cfg.clientSecret);
}

/** Graph path prefix for the acting principal: /me (delegated) or /users/{upn} (app-only). */
export function userBase(ctx: ActionContext): string {
  const cfg = ctx.connection.config as MicrosoftAuthConfig;
  if (cfg.refreshToken) return "/me";
  if (cfg.userUpn) return `/users/${encodeURIComponent(cfg.userUpn)}`;
  throw new Error(
    "microsoft: app-only mode requires userUpn (target mailbox/drive). Set MS_GRAPH_USER_UPN, or connect via OAuth.",
  );
}

export async function microsoftAccessToken(
  ctx: ActionContext,
  pluginName: string,
  scopes: string[],
): Promise<string> {
  const cfg = ctx.connection.config as MicrosoftAuthConfig;
  if (
    cfg.accessToken &&
    typeof cfg.accessTokenExpiresAt === "number" &&
    Date.now() < cfg.accessTokenExpiresAt - REFRESH_SKEW_MS
  ) {
    return cfg.accessToken;
  }

  let body: URLSearchParams;
  if (cfg.refreshToken) {
    if (!cfg.clientId || !cfg.clientSecret) {
      throw new Error(`${pluginName}: missing clientId/clientSecret for OAuth refresh.`);
    }
    body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: "refresh_token",
      scope: [...scopes, "offline_access"].join(" "),
    });
  } else if (isAppOnly(cfg)) {
    body = new URLSearchParams({
      client_id: cfg.clientId as string,
      client_secret: cfg.clientSecret as string,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    });
  } else {
    throw new Error(
      `${pluginName}: no credentials. Connect via OAuth, or set tenantId/clientId/clientSecret (app-only).`,
    );
  }

  const res = await fetch(authority(cfg), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`${pluginName}: token request failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
  const patch: Record<string, unknown> = {
    accessToken: data.access_token,
    accessTokenExpiresAt: Date.now() + data.expires_in * 1000,
  };
  // Microsoft rotates refresh tokens — persist the new one when present.
  if (data.refresh_token) patch.refreshToken = data.refresh_token;
  await ctx.updateConnection(patch);
  return data.access_token;
}

/** Authenticated Graph v1.0 request. Returns parsed JSON ({success:true} for 204). */
export async function graphRequest(
  ctx: ActionContext,
  pluginName: string,
  scopes: string[],
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const token = await microsoftAccessToken(ctx, pluginName, scopes);
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  };
  if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, init);
  if (res.status === 204) return { success: true };
  const text = await res.text();
  if (!res.ok) throw new Error(`${pluginName}: ${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : { success: true };
}

/** Setup help shown by Vex's OAuth wizard for all Microsoft plugins. */
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
