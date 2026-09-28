import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API key, appended by the transport as the api_key query parameter.
 * Callers may never supply api_key themselves; every action is a GET read.
 */
export const hunterCredential = staticCredential({
  id: "hunter",
  auth: { kind: "queryKey", param: "api_key" },
  local: { secret: "apiKey" },
  targets: {
    api: { baseUrl: "https://api.hunter.io/v2/", methods: ["GET"] },
  },
});
