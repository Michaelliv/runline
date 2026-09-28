import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * A long-lived access token, sent as a bearer to the instance's own /api/
 * base. The target carries the scheme `ssl` selects, and config-derived
 * hosts are HTTPS-only: httpsBase refuses the plain-http base that
 * `ssl: false` (the default) selects, as invalid_credentials.
 */
export const homeAssistantCredential = staticCredential({
  id: "homeAssistant",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: (config) => {
    const ssl = config.ssl === true || config.ssl === "true";
    const scheme = ssl ? "https" : "http";
    return {
      api: {
        baseUrl: httpsBase(
          `${scheme}://${String(config.host)}:${config.port ?? 8123}`,
          "api/",
        ),
        methods: ["GET", "POST"],
      },
    };
  },
  probe: {
    target: "api",
    path: "config",
    method: "GET",
    acceptedStatuses: [200],
  },
});
