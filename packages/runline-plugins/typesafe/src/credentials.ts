import { httpsBase, staticCredential } from "../../_shared/credentials.js";

const DEFAULT_BASE = "https://api.typesafe.ai";

/**
 * A TypeSafe API key, sent as a bearer to the configured base's /v1/
 * endpoints. The base URL is public config, defaults to the hosted API,
 * and must be HTTPS.
 */
export const typesafeCredential = staticCredential({
  id: "typesafe",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: (config) => {
    const raw = config.baseUrl;
    const base =
      typeof raw === "string" && raw.trim() ? raw.trim() : DEFAULT_BASE;
    return {
      api: {
        baseUrl: httpsBase(base, "v1/"),
        methods: ["GET", "POST"],
      },
    };
  },
  probe: {
    target: "api",
    path: "models",
    method: "GET",
    acceptedStatuses: [200],
  },
});
