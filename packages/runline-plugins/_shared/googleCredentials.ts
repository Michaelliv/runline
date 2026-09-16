import {
  AuthError,
  type CredentialProbe,
  type CredentialTarget,
  type CredentialType,
  OAuthGrantSchema,
  type OAuthJwtIdentity,
} from "runline";
import * as t from "typebox";

export type GoogleAuthConfig = {
  authMethod?: "delegated" | "serviceAccount";
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  serviceAccountJson?: string;
  serviceAccountEmail?: string;
  serviceAccountPrivateKey?: string;
  serviceAccountSubject?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
};

/** Only legacy storage infers a method; host bindings always select it explicitly. */
export function googleMethod(
  cfg: GoogleAuthConfig,
): "delegated" | "serviceAccount" {
  if (cfg.authMethod !== undefined) {
    if (cfg.authMethod !== "delegated" && cfg.authMethod !== "serviceAccount")
      throw new AuthError("invalid_credentials");
    return cfg.authMethod;
  }
  return cfg.serviceAccountJson ||
    cfg.serviceAccountEmail ||
    cfg.serviceAccountPrivateKey
    ? "serviceAccount"
    : "delegated";
}

export function googleIdentity(cfg: GoogleAuthConfig): OAuthJwtIdentity {
  try {
    const parsed = cfg.serviceAccountJson
      ? JSON.parse(cfg.serviceAccountJson)
      : {
          client_email: cfg.serviceAccountEmail,
          private_key: cfg.serviceAccountPrivateKey,
        };
    if (
      !parsed ||
      typeof parsed.client_email !== "string" ||
      !parsed.client_email ||
      typeof parsed.private_key !== "string" ||
      !parsed.private_key
    )
      throw new Error();
    return {
      issuer: parsed.client_email,
      privateKey: parsed.private_key.replace(/\\n/g, "\n"),
      ...(cfg.serviceAccountSubject === undefined
        ? {}
        : { subject: cfg.serviceAccountSubject }),
    };
  } catch {
    throw new AuthError("invalid_credentials");
  }
}

const API_BASES: Record<string, string> = {
  drive: "https://www.googleapis.com/drive/v3/",
  upload: "https://www.googleapis.com/upload/drive/v3/",
  docs: "https://docs.googleapis.com/v1/",
  sheets: "https://sheets.googleapis.com/v4/",
  slides: "https://slides.googleapis.com/v1/",
  script: "https://script.googleapis.com/v1/",
  tasks: "https://tasks.googleapis.com/tasks/v1/",
  people: "https://people.googleapis.com/",
  calendar: "https://www.googleapis.com/calendar/v3/",
  gmail: "https://gmail.googleapis.com/gmail/v1/users/me/",
};
const PLUGIN_TARGETS: Record<string, string[]> = {
  googleDrive: ["drive", "upload", "docs"],
  googleDocs: ["docs", "drive"],
  googleSheets: ["sheets", "drive"],
  googleSlides: ["slides"],
  googleAppsScript: ["script", "drive"],
  googleTasks: ["tasks"],
  googleContacts: ["people"],
  googleCalendar: ["calendar"],
  gmail: ["gmail"],
};

/** Builtin routing policy, never derived from action input or a returned URL. */
export function googleResources(plugin: string): {
  targets: Record<string, CredentialTarget>;
  probe?: CredentialProbe;
} {
  if (!Object.hasOwn(PLUGIN_TARGETS, plugin))
    throw new AuthError("request_not_allowed");
  const names = PLUGIN_TARGETS[plugin];
  const targets = Object.fromEntries(
    names.map((name) => [
      name,
      {
        baseUrl: API_BASES[name],
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
        ...(name === "upload"
          ? {
              allowedHeaders: [
                "X-Upload-Content-Type",
                "X-Upload-Content-Length",
                "Content-Range",
              ],
              resumableUpload: true,
            }
          : {}),
      },
    ]),
  ) as Record<string, CredentialTarget>;
  const probes: Record<string, [string, string]> = {
    googleDrive: ["drive", "files?pageSize=1&fields=files(id)"],
    googleTasks: ["tasks", "users/@me/lists?maxResults=1"],
    googleContacts: [
      "people",
      "v1/people/me/connections?pageSize=1&personFields=names",
    ],
    googleCalendar: ["calendar", "users/me/calendarList?maxResults=1"],
    gmail: ["gmail", "profile"],
    googleAppsScript: ["drive", "files?pageSize=1&fields=files(id)"],
  };
  const probe = probes[plugin];
  // Docs/Sheets/Slides have no fixed scoped document to probe. Do not guess an ID
  // or require broader Drive permissions merely to manufacture a successful check.
  return {
    targets,
    ...(probe
      ? {
          probe: {
            target: probe[0],
            path: probe[1],
            method: "GET" as const,
            acceptedStatuses: [200],
          },
        }
      : {}),
  };
}

/** Fixed vendor endpoints; a JSON credential's token_uri can never select egress. */
export function googleCredentialType(
  scopes: string[],
  plugin: string,
): CredentialType {
  const url = "https://oauth2.googleapis.com/token";
  const schema = t.Object(
    { grant: t.Optional(OAuthGrantSchema) },
    { additionalProperties: false },
  );
  const { targets, probe } = googleResources(plugin);
  return {
    id: "google.oauth",
    methods: {
      delegated: {
        schema,
        authentication: {
          kind: "oauth2",
          grantField: "grant",
          renewal: "refresh",
          definition: {
            id: "google.oauth",
            provider: "google",
            refresh: { url, clientAuthentication: "client_secret_post" },
          },
        },
        targets,
        probe,
      },
      ...(scopes.length
        ? {
            serviceAccount: {
              schema,
              authentication: {
                kind: "oauth2",
                grantField: "grant",
                renewal: "jwtBearer",
                scopes,
                definition: {
                  id: "google.serviceAccount",
                  provider: "google",
                  jwtBearer: { url, clientAuthentication: "none" },
                },
              },
              targets,
              probe,
            },
          }
        : {}),
    },
  };
}
