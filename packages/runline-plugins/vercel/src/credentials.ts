import { staticCredential } from "../../_shared/credentials.js";

/** An access token, sent as a bearer to Vercel's one API origin. */
export const vercelCredential = staticCredential({
  id: "vercel",
  auth: { kind: "bearer" },
  local: { secret: "token" },
  targets: {
    api: {
      baseUrl: "https://api.vercel.com/",
      methods: ["GET", "POST", "PATCH", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "v2/user",
    method: "GET",
    acceptedStatuses: [200],
  },
});
