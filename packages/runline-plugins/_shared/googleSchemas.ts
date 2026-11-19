import * as t from "typebox";
import { stringEnum } from "./schemas.js";

/**
 * The connection settings every Google plugin takes: the login method,
 * a person's consent (the OAuth client and its refresh token), a service
 * account's key, and the access token runline keeps between calls. `env`
 * prefixes the variables that supply them (`GMAIL` → `GMAIL_CLIENT_ID`).
 */
export function googleConnection(env: string) {
  const text = (name: string, description: string) =>
    t.Optional(t.String({ env: `${env}_${name}`, description }));
  return {
    authMethod: t.Optional(
      stringEnum(["delegated", "serviceAccount"] as const, {
        description:
          "delegated (a person's login) or serviceAccount (a service account's key); a connection that names neither is read by the fields it holds",
      }),
    ),
    clientId: text("CLIENT_ID", "Google OAuth client ID"),
    clientSecret: text("CLIENT_SECRET", "Google OAuth client secret"),
    refreshToken: text(
      "REFRESH_TOKEN",
      "OAuth refresh token, as the login flow stores it",
    ),
    serviceAccountJson: text(
      "SERVICE_ACCOUNT_JSON",
      "Service account key, as the JSON file Google issues",
    ),
    serviceAccountEmail: text(
      "SERVICE_ACCOUNT_EMAIL",
      "Service account email, with serviceAccountPrivateKey in place of the JSON",
    ),
    serviceAccountPrivateKey: text(
      "SERVICE_ACCOUNT_PRIVATE_KEY",
      "Service account private key (PEM)",
    ),
    serviceAccountSubject: text(
      "SERVICE_ACCOUNT_SUBJECT",
      "The user a service account with domain-wide delegation acts as",
    ),
    accessToken: t.Optional(t.String()),
    accessTokenExpiresAt: t.Optional(t.Number()),
  };
}

// ─── Action inputs ──────────────────────────────────────────────

export const NonEmptyString = t.String({ minLength: 1, pattern: "\\S" });
export const Id = t.String({ minLength: 1 });
export const PositiveInteger = t.Integer({ minimum: 1 });
export const NonNegativeInteger = t.Integer({ minimum: 0 });
export const StringArray = t.Array(t.String());
export const NonEmptyStringArray = t.Array(NonEmptyString, { minItems: 1 });
export const StringOrNumber = t.Union([t.String(), t.Number()]);
export const StringOrStringArray = t.Union([t.String(), t.Array(t.String())]);

/** JSON-compatible data whose provider-specific shape is intentionally open. */
export const RawGoogleObject = t.Unsafe<Record<string, unknown>>(
  t.Object({}, { additionalProperties: true }),
);
export const JsonValue = t.Unknown({
  description: "Any JSON-compatible value",
});
export const JsonArray = t.Array(JsonValue);
export const StringMap = t.Record(t.String(), t.String());

export const GoogleTimestamp = t.Union([NonEmptyString, t.Number()], {
  description: "ISO datetime, epoch milliseconds, or epoch seconds",
});
