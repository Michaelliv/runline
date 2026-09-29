import { staticCredential } from "../../_shared/credentials.js";

/** An OAuth2 access token, sent as a bearer to GoTo's one API origin. */
export const gotowebinarCredential = staticCredential({
  id: "gotowebinar",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.getgo.com/G2W/rest/v2/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
});
