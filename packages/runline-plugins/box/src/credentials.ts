import { staticCredential } from "../../_shared/credentials.js";

/** An OAuth2 access or developer token, sent as a bearer to Box's API origin. */
export const boxCredential = staticCredential({
  id: "box",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.box.com/2.0/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "users/me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
