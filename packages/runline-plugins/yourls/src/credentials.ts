import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * A signature token, appended by the transport as the signature query
 * parameter on the installation's own yourls-api.php. The installation
 * URL is public config and must be HTTPS.
 */
export const yourlsCredential = staticCredential({
  id: "yourls",
  auth: { kind: "queryKey", param: "signature" },
  local: { secret: "signature" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.url, ""),
      methods: ["GET"],
    },
  }),
});
