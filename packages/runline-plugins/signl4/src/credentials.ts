import { staticCredential } from "../../_shared/credentials.js";

/** The team secret, which SIGNL4 takes as the webhook's path segment. */
export const signl4Credential = staticCredential({
  id: "signl4",
  auth: {
    kind: "static",
    parts: ["teamSecret"],
    placements: [{ in: "path", part: "teamSecret" }],
  },
  local: { teamSecret: "teamSecret" },
  targets: {
    webhook: {
      baseUrl: "https://connect.signl4.com/webhook/",
      methods: ["POST"],
    },
  },
});
