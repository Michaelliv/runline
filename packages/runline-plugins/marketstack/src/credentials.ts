import { staticCredential } from "../../_shared/credentials.js";

/**
 * An access key, appended by the transport as the access_key query
 * parameter on Marketstack's v1 base. Requests are always HTTPS.
 */
export const marketstackCredential = staticCredential({
  id: "marketstack",
  auth: { kind: "queryKey", param: "access_key" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.marketstack.com/v1/",
      methods: ["GET"],
    },
  },
});
