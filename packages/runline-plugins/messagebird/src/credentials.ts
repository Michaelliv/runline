import { staticCredential } from "../../_shared/credentials.js";

/**
 * An access key, sent as `Authorization: AccessKey {key}` to
 * MessageBird's REST origin.
 */
export const messagebirdCredential = staticCredential({
  id: "messagebird",
  auth: { kind: "apiKey", header: "Authorization", prefix: "AccessKey " },
  local: { secret: "accessKey" },
  targets: {
    api: {
      baseUrl: "https://rest.messagebird.com/",
      methods: ["GET", "POST"],
    },
  },
  probe: {
    target: "api",
    path: "balance",
    method: "GET",
    acceptedStatuses: [200],
  },
});
