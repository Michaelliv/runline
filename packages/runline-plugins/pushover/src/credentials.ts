import { staticCredential } from "../../_shared/credentials.js";

/** An application token, added by the transport as the token field of Pushover's form body. */
export const pushoverCredential = staticCredential({
  id: "pushover",
  auth: {
    kind: "static",
    parts: ["token"],
    placements: [{ in: "body", part: "token", name: "token" }],
  },
  local: { token: "apiToken" },
  targets: {
    api: { baseUrl: "https://api.pushover.net/1/", methods: ["POST"] },
  },
});
