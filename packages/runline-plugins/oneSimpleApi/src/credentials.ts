import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API token, appended by the transport as the token query parameter on
 * OneSimpleAPI's one origin.
 */
export const oneSimpleApiCredential = staticCredential({
  id: "oneSimpleApi",
  auth: { kind: "queryKey", param: "token" },
  local: { secret: "apiToken" },
  targets: {
    api: {
      baseUrl: "https://onesimpleapi.com/api/",
      methods: ["GET"],
    },
  },
});
