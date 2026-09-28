import {
  type CredentialDeclaration,
  type CredentialTarget,
  OAuthGrantSchema,
} from "runline";
import * as t from "typebox";
import { configChoice, httpsBase } from "../../_shared/credentials.js";

/**
 * An organization API key (client id and secret), exchanged for a bearer
 * token via the client-credentials grant against Bitwarden's identity
 * service — the cloud one, or the self-hosted instance's own. Requests go
 * to the matching Public API beneath /public/. A self-hosted connection
 * must name its HTTPS domain; it is never sent to the cloud instead. The
 * device fields are the fixed client registration Bitwarden's token
 * endpoint requires.
 */
export const bitwardenCredential: CredentialDeclaration = (config) => {
  const selfHosted =
    configChoice(
      config.environment,
      ["cloudHosted", "selfHosted"],
      "cloudHosted",
    ) === "selfHosted";
  const api: CredentialTarget = {
    baseUrl: selfHosted
      ? httpsBase(config.domain, "api/public/")
      : "https://api.bitwarden.com/public/",
    methods: ["GET", "POST", "PUT", "DELETE"],
  };
  return {
    type: {
      id: "bitwarden",
      methods: {
        oauth2: {
          schema: t.Object(
            { grant: t.Optional(OAuthGrantSchema) },
            { additionalProperties: false },
          ),
          authentication: {
            kind: "oauth2",
            field: "grant",
            definition: {
              id: "bitwarden.oauth2",
              provider: "bitwarden",
              clientCredentials: {
                url: selfHosted
                  ? httpsBase(config.domain, "identity/connect/token")
                  : "https://identity.bitwarden.com/connect/token",
                clientAuthentication: "client_secret_post",
                parameters: {
                  deviceName: "runline",
                  deviceType: "2",
                  deviceIdentifier: "runline",
                },
              },
            },
            renewal: "clientCredentials",
            scopes: ["api.organization"],
          },
          targets: { api },
          probe: {
            target: "api",
            path: "collections",
            method: "GET",
            acceptedStatuses: [200],
          },
        },
      },
    },
    method: "oauth2",
    application: {
      clientId: config.clientId as string,
      clientSecret: config.clientSecret as string | undefined,
    },
  };
};
