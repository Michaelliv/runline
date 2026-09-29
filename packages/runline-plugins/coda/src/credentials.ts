import { staticCredential } from "../../_shared/credentials.js";

/** An API token, sent as a bearer to Coda's one API origin. */
export const codaCredential = staticCredential({
  id: "coda",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://coda.io/apis/v1/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "whoami",
    method: "GET",
    acceptedStatuses: [200],
  },
});
