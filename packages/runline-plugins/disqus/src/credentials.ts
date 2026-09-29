import { staticCredential } from "../../_shared/credentials.js";

/** An access token, sent as the api_key query parameter on read-only GETs. */
export const disqusCredential = staticCredential({
  id: "disqus",
  auth: { kind: "queryKey", param: "api_key" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://disqus.com/api/3.0/",
      methods: ["GET"],
    },
  },
});
