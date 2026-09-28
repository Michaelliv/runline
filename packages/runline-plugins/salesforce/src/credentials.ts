import {
  AuthError,
  type CredentialDeclaration,
  type CredentialTarget,
} from "runline";
import {
  configChoice,
  grantSchema,
  httpsBase,
  staticCredential,
} from "../../_shared/credentials.js";

/**
 * A path beneath the org's My Domain URL. A Lightning UI host serves no
 * API, and is refused as invalid_credentials.
 */
function myDomain(value: unknown, path: string): string {
  const url = httpsBase(value, path);
  if (/\.lightning\.force\.com$/i.test(new URL(url).hostname))
    throw new AuthError("invalid_credentials");
  return url;
}

/** The REST API on the org's My Domain instance. */
function api(config: Readonly<Record<string, unknown>>): CredentialTarget {
  return {
    baseUrl: myDomain(config.instanceUrl ?? config.loginUrl, ""),
    methods: ["GET", "POST", "PATCH", "DELETE"],
  };
}

const accessToken = staticCredential({
  id: "salesforce",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: (config) => ({ api: api(config) }),
});

/**
 * A static access token as a bearer, or a Connected App's client
 * credentials exchanged at the My Domain token endpoint; either signs the
 * REST API on the same My Domain instance. `authMethod` picks one;
 * without it, a connection naming a client ID uses client credentials —
 * the token the CLI keeps from that exchange is stored as `accessToken`
 * too, so a token alone does not decide — and any other uses its token.
 */
export const salesforceCredential: CredentialDeclaration = (config) => {
  const token = accessToken(config);
  const method = configChoice(
    config.authMethod ??
      (config.clientId ? "clientCredentials" : "accessToken"),
    ["accessToken", "clientCredentials"],
    "accessToken",
  );
  const type = {
    id: "salesforce",
    methods: {
      ...token.type.methods,
      clientCredentials: {
        schema: grantSchema,
        authentication: {
          kind: "oauth2" as const,
          field: "grant",
          renewal: "clientCredentials" as const,
          definition: {
            id: "salesforce.oauth2",
            provider: "salesforce",
            clientCredentials: {
              url: myDomain(
                config.loginUrl ?? config.instanceUrl,
                "services/oauth2/token",
              ),
              clientAuthentication: "client_secret_post" as const,
            },
          },
        },
        targets: { api: api(config) },
      },
    },
  };
  if (method === "accessToken") return { ...token, type };
  return {
    type,
    method: "clientCredentials",
    application: {
      clientId: config.clientId as string,
      ...(typeof config.clientSecret === "string"
        ? { clientSecret: config.clientSecret }
        : {}),
    },
  };
};
