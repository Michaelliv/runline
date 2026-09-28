import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/** An auth token, sent as a bearer to the configured management origin. */
export const splunkCredential = staticCredential({
  id: "splunk",
  auth: { kind: "bearer" },
  local: { secret: "authToken" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.baseUrl, "services/"),
      methods: ["GET", "POST", "DELETE"],
    },
  }),
  probe: {
    target: "api",
    path: "authentication/current-context?output_mode=json",
    method: "GET",
    acceptedStatuses: [200],
  },
});
