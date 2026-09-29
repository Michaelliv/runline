import { staticCredential } from "../../_shared/credentials.js";

/** An access token, sent as a bearer to Bitly's one API origin. */
export const bitlyCredential = staticCredential({
  id: "bitly",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api-ssl.bitly.com/v4/",
      methods: ["GET", "POST", "PATCH"],
    },
  },
  probe: {
    target: "api",
    path: "user",
    method: "GET",
    acceptedStatuses: [200],
  },
});
