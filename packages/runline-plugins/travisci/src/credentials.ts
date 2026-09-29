import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API token, sent as `Authorization: token <token>` to Travis CI's v3
 * API. A repository slug travels as one encoded segment.
 */
export const travisciCredential = staticCredential({
  id: "travisci",
  auth: { kind: "apiKey", header: "Authorization", prefix: "token " },
  local: { secret: "apiToken" },
  targets: {
    api: {
      baseUrl: "https://api.travis-ci.com/",
      methods: ["GET", "POST"],
      allowedHeaders: ["Travis-API-Version"],
      encodedSlashes: true,
    },
  },
  probe: {
    target: "api",
    path: "user",
    method: "GET",
    acceptedStatuses: [200],
  },
});
