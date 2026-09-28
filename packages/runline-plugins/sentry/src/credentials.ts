import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * An auth token, sent as a bearer beneath /api/0/ of sentry.io or the
 * connection's own self-hosted instance.
 */
export const sentryCredential = staticCredential({
  id: "sentry",
  auth: { kind: "bearer" },
  local: { secret: "token" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.url ?? "https://sentry.io", "api/0/"),
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
});
