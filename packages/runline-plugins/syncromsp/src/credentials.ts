import { hostLabel, staticCredential } from "../../_shared/credentials.js";

/**
 * An API key, appended by the transport as the api_key query parameter
 * on the account's own SyncroMSP subdomain.
 */
export const syncromspCredential = staticCredential({
  id: "syncromsp",
  auth: { kind: "queryKey", param: "api_key" },
  local: { secret: "apiKey" },
  targets: (config) => ({
    api: {
      baseUrl: `https://${hostLabel(config.subdomain)}.syncromsp.com/api/v1/`,
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
});
