import { type CredentialDeclaration, OAuthGrantSchema } from "runline";
import * as t from "typebox";

/**
 * A client-credentials OAuth grant against the environment's own token
 * endpoint. The env config field picks live or sandbox; both the token
 * request and every API call stay on that one host.
 */
export const paypalCredential: CredentialDeclaration = (config) => {
  const base =
    config.env === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";
  return {
    type: {
      id: "paypal",
      methods: {
        oauth2: {
          schema: t.Object(
            { grant: t.Optional(OAuthGrantSchema) },
            { additionalProperties: false },
          ),
          authentication: {
            kind: "oauth2",
            field: "grant",
            renewal: "clientCredentials",
            definition: {
              id: "paypal.oauth2",
              provider: "paypal",
              clientCredentials: {
                url: `${base}/v1/oauth2/token`,
                clientAuthentication: "client_secret_basic",
              },
            },
          },
          targets: {
            api: { baseUrl: `${base}/v1/`, methods: ["GET", "POST"] },
          },
        },
      },
    },
    method: "oauth2",
    application: {
      clientId: config.clientId as string,
      ...(typeof config.secret === "string"
        ? { clientSecret: config.secret }
        : {}),
    },
  };
};
