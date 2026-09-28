import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API key and a user token, both appended by the transport as the key
 * and token query parameters on Trello's one API origin.
 */
export const trelloCredential = staticCredential({
  id: "trello",
  auth: {
    kind: "static",
    parts: ["key", "token"],
    placements: [
      { in: "query", part: "key", name: "key" },
      { in: "query", part: "token", name: "token" },
    ],
  },
  local: { key: "apiKey", token: "token" },
  targets: {
    api: {
      baseUrl: "https://api.trello.com/1/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "members/me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
