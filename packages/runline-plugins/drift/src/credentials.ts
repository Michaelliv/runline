import { staticCredential } from "../../_shared/credentials.js";

/** An API access token, sent as a bearer to Drift's one API origin. */
export const driftCredential = staticCredential({
  id: "drift",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://driftapi.com/",
      methods: ["GET", "POST", "PATCH", "DELETE"],
    },
  },
});
