import {
  AuthError,
  type CredentialDeclaration,
  type CredentialType,
} from "runline";
import { configChoice, grantSchema, httpsBase } from "../../_shared/credentials.js";

/**
 * A client-credentials OAuth grant: the token comes from the configured
 * auth server (cloud, optionally tenant-qualified) or the on-premise app's
 * /auth/token, and signs as a bearer against the configured resource API
 * base. Every URL is public config and must be HTTPS.
 */
export const halopsaCredential: CredentialDeclaration = (config) => {
  let tokenUrl =
    configChoice(config.hostingType, ["cloud", "on-premise"], "cloud") ===
    "on-premise"
      ? httpsBase(config.appUrl, "auth/token")
      : httpsBase(config.authUrl, "token");
  if (config.tenant !== undefined) {
    if (typeof config.tenant !== "string" || !config.tenant)
      throw new AuthError("invalid_credentials");
    tokenUrl += `?tenant=${encodeURIComponent(config.tenant)}`;
  }
  const scope =
    typeof config.scope === "string" && config.scope ? config.scope : "all";
  const type: CredentialType = {
    id: "halopsa",
    methods: {
      oauth2: {
        schema: grantSchema,
        authentication: {
          kind: "oauth2",
          field: "grant",
          renewal: "clientCredentials",
          definition: {
            id: "halopsa.oauth2",
            provider: "halopsa",
            clientCredentials: {
              url: tokenUrl,
              clientAuthentication: "client_secret_post",
            },
          },
          scopes: [scope],
        },
        targets: {
          api: {
            baseUrl: httpsBase(config.resourceApiUrl, ""),
            methods: ["GET", "POST", "PUT", "DELETE"],
          },
        },
      },
    },
  };
  return {
    type,
    method: "oauth2",
    application: {
      clientId: config.clientId as string,
      clientSecret: config.clientSecret as string | undefined,
    },
  };
};
