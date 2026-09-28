import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API key, sent raw as the Authorization header (no scheme) to
 * UpLead's one API origin.
 */
export const upleadCredential = staticCredential({
  id: "uplead",
  auth: { kind: "apiKey", header: "Authorization" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.uplead.com/v2/",
      methods: ["GET"],
    },
  },
});
