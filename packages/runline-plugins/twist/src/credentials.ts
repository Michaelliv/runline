import { staticCredential } from "../../_shared/credentials.js";

/** An OAuth2 access token, sent as a bearer to Twist's one API origin. */
export const twistCredential = staticCredential({
  id: "twist",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.twist.com/api/v3/",
      methods: ["GET", "POST"],
    },
  },
});
