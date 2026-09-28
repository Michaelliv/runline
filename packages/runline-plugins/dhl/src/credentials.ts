import { staticCredential } from "../../_shared/credentials.js";

/** An API key, sent as the DHL-API-Key header to DHL's EU API origin. */
export const dhlCredential = staticCredential({
  id: "dhl",
  auth: { kind: "apiKey", header: "DHL-API-Key" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api-eu.dhl.com/",
      methods: ["GET"],
    },
  },
});
