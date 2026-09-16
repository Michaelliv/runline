import {
  AuthError,
  OAuthGrantSchema,
  type CredentialMethod,
  type CredentialProbe,
  type CredentialType,
} from "runline";
import * as t from "typebox";

export type MicrosoftAuthConfig = {
  authMethod?: "delegated" | "appOnly";
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  userUpn?: string;
  driveId?: string;
  siteId?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
};

/** Compatibility inference is confined to legacy configs without an explicit method. */
export function microsoftMethod(
  cfg: MicrosoftAuthConfig,
): "delegated" | "appOnly" {
  if (cfg.authMethod !== undefined) {
    if (cfg.authMethod !== "delegated" && cfg.authMethod !== "appOnly")
      throw new AuthError("invalid_credentials");
    return cfg.authMethod;
  }
  return !cfg.refreshToken && cfg.tenantId && cfg.clientId && cfg.clientSecret
    ? "appOnly"
    : "delegated";
}

export function microsoftUserBase(cfg: MicrosoftAuthConfig): string {
  if (microsoftMethod(cfg) === "delegated") return "/me";
  if (!cfg.userUpn) throw new AuthError("invalid_credentials");
  return `/users/${encodeURIComponent(cfg.userUpn)}`;
}

export function microsoftDriveBase(cfg: MicrosoftAuthConfig): string {
  if (cfg.driveId) return `/drives/${encodeURIComponent(cfg.driveId)}`;
  if (cfg.siteId) return `/sites/${encodeURIComponent(cfg.siteId)}/drive`;
  return `${microsoftUserBase(cfg)}/drive`;
}

/** Scope-appropriate probes never require User.Read merely to check mail/calendar/files. */
export function microsoftCredentialType(
  cfg: MicrosoftAuthConfig,
  plugin: string,
  scopes: string[],
): CredentialType {
  const tenant = cfg.tenantId || "common";
  if (!/^[a-zA-Z0-9.-]+$/.test(tenant))
    throw new AuthError("invalid_credentials");
  const endpoint = {
    url: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    clientAuthentication: "client_secret_post" as const,
  };
  const schema = t.Object(
    { grant: t.Optional(OAuthGrantSchema) },
    { additionalProperties: false },
  );
  const methods = Object.fromEntries(
    (["delegated", "appOnly"] as const).map(
      (method): [string, CredentialMethod] => {
        let probe: CredentialProbe | undefined;
        const selected = { ...cfg, authMethod: method };
        if (
          method === "delegated" ||
          cfg.userUpn ||
          (plugin === "microsoftFiles" && (cfg.driveId || cfg.siteId))
        ) {
          const path =
            plugin === "microsoftMail"
              ? `${microsoftUserBase(selected)}/messages?$top=1&$select=id`
              : plugin === "microsoftCalendar"
                ? `${microsoftUserBase(selected)}/events?$top=1&$select=id`
                : plugin === "microsoftFiles"
                  ? `${microsoftDriveBase(selected)}/root?$select=id`
                  : undefined;
          if (path)
            probe = {
              target: "graph",
              path: path.slice(1),
              method: "GET",
              acceptedStatuses: [200],
            };
        }
        return [
          method,
          {
            schema,
            authentication: {
              kind: "oauth2" as const,
              grantField: "grant",
              renewal:
                method === "delegated"
                  ? ("refresh" as const)
                  : ("clientCredentials" as const),
              definition: {
                id: "microsoft.oauth",
                provider: "microsoft",
                refresh: endpoint,
                clientCredentials: endpoint,
              },
              scopes:
                method === "delegated"
                  ? [...scopes, "offline_access"]
                  : ["https://graph.microsoft.com/.default"],
            },
            targets: {
              graph: {
                baseUrl: "https://graph.microsoft.com/v1.0/",
                methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
              },
            },
            ...(probe ? { probe } : {}),
          },
        ];
      },
    ),
  );
  return { id: "microsoft.graph", methods };
}
