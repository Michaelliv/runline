import {
  type CredentialDeclaration,
  type CredentialTarget,
  type CredentialType,
  configChoice,
  grantSchema,
  staticCredential,
} from "@shiftlabs/codemode";

/** Dropbox's token endpoint: code exchange and refresh both land here. */
export const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
export const DROPBOX_AUTH_URL = "https://www.dropbox.com/oauth2/authorize";

/**
 * Scopes a scoped app must have ticked on its Permissions tab. Dropbox
 * grants the app's configured scopes regardless of what is requested, and
 * a scope the app lacks fails at call time (`missing_scope`), not at login.
 */
export const SCOPES = [
  "account_info.read",
  "files.metadata.read",
  "files.metadata.write",
  "files.content.read",
  "files.content.write",
  "sharing.read",
  "sharing.write",
];

/**
 * Two hosts: RPC calls (JSON in, JSON out) on api.dropboxapi.com, and
 * content calls (bytes in or out, arguments in the `Dropbox-API-Arg`
 * header) on content.dropboxapi.com. Both take POST only.
 */
const TARGETS: Record<string, CredentialTarget> = {
  api: { baseUrl: "https://api.dropboxapi.com/2/", methods: ["POST"] },
  content: {
    baseUrl: "https://content.dropboxapi.com/2/",
    methods: ["POST"],
    allowedHeaders: ["Dropbox-API-Arg"],
    // A download is read whole into memory, so it is bounded.
    maxResponseBytes: 150 * 1024 * 1024,
    timeoutMs: 10 * 60_000,
  },
};

/** A pasted access token. Dropbox's access tokens last 4 hours. */
const accessToken = staticCredential({
  id: "dropbox",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: TARGETS,
});

/**
 * A static access token as a bearer, or an app's offline grant: a
 * long-lived refresh token renewed at Dropbox's token endpoint, whose
 * short-lived access tokens sign both hosts. `authMethod` picks one;
 * without it a connection holding a refresh token uses the grant (the
 * renewed access token is stored as `accessToken` too, so a token alone
 * does not decide), and any other uses its token.
 */
export const dropboxCredential: CredentialDeclaration = (config) => {
  const token = accessToken(config);
  const method = configChoice(
    config.authMethod ?? (config.refreshToken ? "oauth2" : "bearer"),
    ["bearer", "oauth2"],
    "bearer",
  );
  const type: CredentialType = {
    id: "dropbox",
    methods: {
      ...token.type.methods,
      oauth2: {
        schema: grantSchema,
        authentication: {
          kind: "oauth2",
          field: "grant",
          renewal: "refresh",
          scopes: SCOPES,
          definition: {
            id: "dropbox.oauth2",
            provider: "dropbox",
            refresh: {
              url: DROPBOX_TOKEN_URL,
              clientAuthentication: "client_secret_post",
            },
          },
        },
        // No probe: a probe is a GET or HEAD, and every Dropbox endpoint is
        // POST. account.get is the connection check.
        targets: TARGETS,
      },
    },
  };
  if (method === "bearer") return { ...token, type };
  return {
    type,
    method: "oauth2",
    application: {
      clientId: config.clientId as string,
      ...(typeof config.clientSecret === "string"
        ? { clientSecret: config.clientSecret }
        : {}),
    },
  };
};
