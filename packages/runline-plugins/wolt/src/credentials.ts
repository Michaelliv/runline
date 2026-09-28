import {
  type CredentialDeclaration,
  type CredentialTarget,
  OAuthGrantSchema,
} from "runline";
import * as t from "typebox";

export const RESTAURANT = "restaurant-api.wolt.com";
export const CONSUMER = "consumer-api.wolt.com";
export const AUTH = "authentication.wolt.com";

/** Mobile client headers; the authed endpoints reject anything that is not the app. */
const MOBILE: Record<string, string> = {
  "app-language": "en",
  "app-locale": "en-US",
  "client-version": "26.30.4",
  clientversionnumber: "142026304",
  platform: "Android",
  "user-agent": "Wolt/26.30.4; Build/142026304; Android/16; Google sdk_gphone",
};

/** Headers every authenticated or login call carries: the app, and this device's session. */
export function clientHeaders(
  config: Readonly<Record<string, unknown>>,
): Record<string, string> {
  return {
    ...MOBILE,
    "w-wolt-session-id": String(config.woltSessionId ?? ""),
    "x-wolt-visitor-id": String(config.visitorId ?? ""),
  };
}

/**
 * The owner's Wolt session: a refresh token, renewed at Wolt's token
 * endpoint as the mobile app does it — its headers, and the device token
 * the session is bound to — into access tokens that sign the restaurant
 * and consumer APIs. Wolt rotates the refresh token on every grant. The
 * device identifiers are public config; the owner login seeds the grant.
 */
export const woltCredential: CredentialDeclaration = (config) => {
  const headers = clientHeaders(config);
  const api = (host: string): CredentialTarget => ({
    baseUrl: `https://${host}/`,
    methods: ["GET", "POST", "PUT"],
    allowedHeaders: Object.keys(headers),
    maxResponseBytes: 8 * 1024 * 1024,
  });
  return {
    type: {
      id: "wolt",
      methods: {
        oauth2: {
          schema: t.Object(
            { grant: t.Optional(OAuthGrantSchema) },
            { additionalProperties: false },
          ),
          authentication: {
            kind: "oauth2",
            field: "grant",
            renewal: "refresh",
            definition: {
              id: "wolt.oauth2",
              provider: "wolt",
              refresh: {
                url: `https://${AUTH}/v1/wauth2/access_token`,
                clientAuthentication: "none",
                headers,
                parameters: { device_token: String(config.deviceToken ?? "") },
              },
            },
          },
          targets: { restaurant: api(RESTAURANT), consumer: api(CONSUMER) },
        },
      },
    },
    method: "oauth2",
  };
};
