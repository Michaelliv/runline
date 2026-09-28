import { staticCredential } from "../../_shared/credentials.js";

/** An OSDI API token, sent as the OSDI-API-Token header to Action Network's
 *  one API origin. */
export const actionNetworkCredential = staticCredential({
  id: "actionNetwork",
  auth: { kind: "apiKey", header: "OSDI-API-Token" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://actionnetwork.org/api/v2/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
});
