import { staticCredential } from "../../_shared/credentials.js";

/**
 * The auth ID and token: the ID is both the Basic username and the account
 * segment of every path, so one stored part serves both.
 */
export const plivoCredential = staticCredential({
  id: "plivo",
  auth: {
    kind: "static",
    parts: ["authId", "authToken"],
    placements: [
      { in: "path", part: "authId" },
      { in: "basic", username: "authId", password: "authToken" },
    ],
  },
  local: { authId: "authId", authToken: "authToken" },
  targets: {
    api: { baseUrl: "https://api.plivo.com/v1/Account/", methods: ["POST"] },
  },
});
