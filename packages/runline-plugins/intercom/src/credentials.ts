import { staticCredential } from "../../_shared/credentials.js";

/** An access token, sent as a bearer to Intercom's one API origin. */
export const intercomCredential = staticCredential({
  id: "intercom",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.intercom.io/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
