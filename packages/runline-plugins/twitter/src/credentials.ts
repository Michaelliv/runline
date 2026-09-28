import { staticCredential } from "../../_shared/credentials.js";

/**
 * An OAuth2 token (app-only or user-context), sent as a bearer to the
 * Twitter/X v2 API origin.
 */
export const twitterCredential = staticCredential({
  id: "twitter",
  auth: { kind: "bearer" },
  local: { secret: "bearerToken" },
  targets: {
    api: {
      baseUrl: "https://api.twitter.com/2/",
      methods: ["GET", "POST", "DELETE"],
    },
  },
});
