import { staticCredential } from "../../_shared/credentials.js";

/** A user or bot access token, sent as a bearer to Webex's one API origin. */
export const ciscoWebexCredential = staticCredential({
  id: "ciscoWebex",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://webexapis.com/v1/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "people/me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
