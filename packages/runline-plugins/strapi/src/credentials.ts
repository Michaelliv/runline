import {
  type CredentialDeclaration,
  type CredentialTarget,
  type CredentialType,
} from "runline";
import {
  configChoice,
  grantSchema,
  httpsBase,
  staticCredential,
} from "../../_shared/credentials.js";

/** The Strapi major version the connection names, v4 when absent. */
export function strapiVersion(
  config: Readonly<Record<string, unknown>>,
): "v4" | "v3" {
  return configChoice(config.apiVersion, ["v4", "v3"], "v4");
}

/** The content API beneath the instance: `api/` on v4, the root on v3. */
function apiBase(config: Readonly<Record<string, unknown>>): {
  prefix: string;
  target: CredentialTarget;
} {
  const prefix = strapiVersion(config) === "v4" ? "api/" : "";
  return {
    prefix,
    target: {
      baseUrl: httpsBase(config.url, prefix),
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  };
}

const apiToken = staticCredential({
  id: "strapi",
  auth: { kind: "bearer" },
  local: { secret: "apiToken" },
  targets: (config) => ({ api: apiBase(config).target }),
});

/**
 * An API token as a bearer, or a user's email and password, logged in at
 * the instance's /auth/local for a JWT the transport stores and signs
 * with, logging in again when Strapi rejects it. `authMethod` picks one;
 * without it, a connection holding a token uses the token and one naming
 * an email logs in. The instance URL is public config and must be HTTPS.
 */
export const strapiCredential: CredentialDeclaration = (config) => {
  const token = apiToken(config);
  const method = configChoice(
    config.authMethod ??
      (config.apiToken ? "apiToken" : config.email ? "password" : "apiToken"),
    ["apiToken", "password"],
    "apiToken",
  );
  const { prefix, target } = apiBase(config);
  const type: CredentialType = {
    id: "strapi",
    methods: {
      ...token.type.methods,
      password: {
        schema: grantSchema,
        authentication: {
          kind: "oauth2",
          field: "grant",
          renewal: "password",
          definition: {
            id: "strapi.login",
            provider: "strapi",
            password: {
              url: httpsBase(config.url, `${prefix}auth/local`),
              clientAuthentication: "none",
              encoding: "json",
              grantType: null,
              fields: { username: "identifier" },
              response: { accessToken: "jwt" },
            },
          },
        },
        targets: { api: target },
      },
    },
  };
  if (method === "apiToken") return { ...token, type };
  return {
    type,
    method: "password",
    ...(typeof config.email === "string" && typeof config.password === "string"
      ? { resourceOwner: { username: config.email, password: config.password } }
      : {}),
  };
};
