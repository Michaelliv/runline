import { staticCredential } from "../../_shared/credentials.js";

/**
 * A REST API token, sent as `Authorization: Token token={key}` to
 * PagerDuty's one API origin. From is the caller's attribution email on
 * incident writes.
 */
export const pagerdutyCredential = staticCredential({
  id: "pagerduty",
  auth: { kind: "apiKey", header: "Authorization", prefix: "Token token=" },
  local: { secret: "apiToken" },
  targets: {
    api: {
      baseUrl: "https://api.pagerduty.com/",
      methods: ["GET", "POST", "PUT"],
      allowedHeaders: ["From"],
    },
  },
  probe: {
    target: "api",
    path: "abilities",
    method: "GET",
    acceptedStatuses: [200],
  },
});
