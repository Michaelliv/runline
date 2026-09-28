import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API key, sent as `Authorization: Token {key}` to SecurityScorecard's
 * one API origin.
 */
export const securityScorecardCredential = staticCredential({
  id: "securityScorecard",
  auth: { kind: "apiKey", header: "Authorization", prefix: "Token " },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.securityscorecard.io/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "portfolios",
    method: "GET",
    acceptedStatuses: [200],
  },
});
