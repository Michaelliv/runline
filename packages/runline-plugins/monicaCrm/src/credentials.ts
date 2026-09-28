import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/** An API token, sent as a bearer to the instance's own /api/ (hosted Monica by default). */
export const monicaCrmCredential = staticCredential({
  id: "monicaCrm",
  auth: { kind: "bearer" },
  local: { secret: "apiToken" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.url || "https://app.monicahq.com", "api/"),
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
  probe: {
    target: "api",
    path: "me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
