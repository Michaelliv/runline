import { staticCredential } from "../../_shared/credentials.js";

/** An OAuth2 access token, sent as a bearer to Keap's one API origin. */
export const keapCredential = staticCredential({
  id: "keap",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.infusionsoft.com/crm/rest/v1/",
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "account/profile",
    method: "GET",
    acceptedStatuses: [200],
  },
});
