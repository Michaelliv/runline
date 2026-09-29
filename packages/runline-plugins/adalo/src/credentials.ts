import { staticCredential } from "../../_shared/credentials.js";

/**
 * An app API key, sent as a bearer to Adalo's apps base. The app ID is
 * public config and rides as the first path segment of every request.
 */
export const adaloCredential = staticCredential({
  id: "adalo",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.adalo.com/v0/apps/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
});
