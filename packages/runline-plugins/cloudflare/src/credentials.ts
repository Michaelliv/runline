import { staticCredential } from "../../_shared/credentials.js";

/** An API token, sent as a bearer to Cloudflare's one API origin. */
export const cloudflareCredential = staticCredential({
  id: "cloudflare",
  auth: { kind: "bearer" },
  local: { secret: "apiToken" },
  targets: {
    api: {
      baseUrl: "https://api.cloudflare.com/client/v4/",
      methods: ["GET", "POST", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "user/tokens/verify",
    method: "GET",
    acceptedStatuses: [200],
  },
});
