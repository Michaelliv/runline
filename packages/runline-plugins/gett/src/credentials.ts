import { AuthError, type CredentialDeclaration } from "runline";
import { grantSchema, pathSegment } from "../../_shared/credentials.js";

export const HOST = "b2cgateway.gett.com";
export const APP_VERSION = "10.48.187";

/** What the Android app sends on every call: its own identity, and the device's. */
export function appHeaders(
  config: Readonly<Record<string, unknown>>,
): Record<string, string> {
  return {
    "user-agent": `Gett/android/${APP_VERSION}`,
    "app-platform": "android",
    "app-version": APP_VERSION,
    "x-device-id": String(config.deviceId ?? ""),
    "x-client-device-unique-id": String(config.clientDeviceUniqueId ?? ""),
    "x-country-code": "IL",
  };
}

/**
 * The owner's Gett session: a long-lived refresh token, renewed at the
 * account's GL token endpoint — as the app does it, with the app's headers
 * and the refresh token as bearer — into access tokens that sign every call
 * to the gateway. The phone and device IDs are public config; the owner
 * login seeds the grant.
 */
export const gettCredential: CredentialDeclaration = (config) => {
  if (typeof config.phone !== "string" || !config.phone.trim())
    throw new AuthError("invalid_credentials");
  const phone = pathSegment(config.phone.trim());
  const headers = appHeaders(config);
  return {
    type: {
      id: "gett",
      methods: {
        oauth2: {
          schema: grantSchema,
          authentication: {
            kind: "oauth2",
            field: "grant",
            renewal: "refresh",
            definition: {
              id: "gett.oauth2",
              provider: "gett",
              // `?lc=en` is required: without it the grant 400s with an empty body.
              refresh: {
                url: `https://${HOST}/gl/api/v2/phone/${phone}/auth/token?lc=en`,
                clientAuthentication: "none",
                encoding: "json",
                headers,
                refreshTokenBearer: true,
              },
            },
          },
          targets: {
            api: {
              baseUrl: `https://${HOST}/`,
              methods: ["GET", "POST"],
              allowedHeaders: Object.keys(headers),
              maxResponseBytes: 4 * 1024 * 1024,
            },
          },
        },
      },
    },
    method: "oauth2",
  };
};
