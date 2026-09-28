import { staticCredential } from "../../_shared/credentials.js";

/** An OAuth2 app access token, sent as a bearer to Help Scout's v2 API. */
export const helpscoutCredential = staticCredential({
  id: "helpscout",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.helpscout.net/v2/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
});
