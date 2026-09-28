import { staticCredential } from "../../_shared/credentials.js";

/** An API key, sent as the Api-Key header to Tapfiliate's 1.6 API. */
export const tapfiliateCredential = staticCredential({
  id: "tapfiliate",
  auth: { kind: "apiKey", header: "Api-Key" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.tapfiliate.com/1.6/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
});
