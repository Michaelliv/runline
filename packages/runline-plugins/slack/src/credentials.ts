import { staticCredential } from "../../_shared/credentials.js";

/** A bot or user token, sent as a bearer to Slack's one API origin. */
export const slackCredential = staticCredential({
  id: "slack",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://slack.com/api/",
      methods: ["GET", "POST"],
    },
  },
  probe: {
    target: "api",
    path: "auth.test",
    method: "GET",
    acceptedStatuses: [200],
  },
});
