import { staticCredential } from "../../_shared/credentials.js";

/** An access token, sent as a bearer to Raindrop's one API origin. */
export const raindropCredential = staticCredential({
  id: "raindrop",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.raindrop.io/rest/v1/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "user",
    method: "GET",
    acceptedStatuses: [200],
  },
});
