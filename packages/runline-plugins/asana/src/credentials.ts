import { staticCredential } from "../../_shared/credentials.js";

/** A personal access token, sent as a bearer to Asana's one API origin. */
export const asanaCredential = staticCredential({
  id: "asana",
  auth: { kind: "bearer" },
  local: { secret: "token" },
  targets: {
    api: {
      baseUrl: "https://app.asana.com/api/1.0/",
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
