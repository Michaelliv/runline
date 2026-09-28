import { staticCredential } from "../../_shared/credentials.js";

export const REPLICATE_BASE = "https://api.replicate.com/v1/";

/**
 * An API token, sent as a bearer to Replicate's v1 API. `Prefer: wait`
 * lets the server hold a create open for fast predictions.
 */
export const replicateCredential = staticCredential({
  id: "replicate",
  auth: { kind: "bearer" },
  local: { secret: "apiToken" },
  targets: {
    api: {
      baseUrl: REPLICATE_BASE,
      methods: ["GET", "POST"],
      allowedHeaders: ["Prefer"],
    },
  },
  probe: {
    target: "api",
    path: "account",
    method: "GET",
    acceptedStatuses: [200],
  },
});
