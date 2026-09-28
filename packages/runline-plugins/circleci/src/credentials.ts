import { staticCredential } from "../../_shared/credentials.js";

/** A personal API token, sent in the Circle-Token header to CircleCI's API. */
export const circleciCredential = staticCredential({
  id: "circleci",
  auth: { kind: "apiKey", header: "Circle-Token" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://circleci.com/api/v2/",
      methods: ["GET", "POST"],
    },
  },
  probe: {
    target: "api",
    path: "me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
