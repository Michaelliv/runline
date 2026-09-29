import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * The Nitro admin password, sent as the X-NITRO-PASS header to the
 * appliance's /nitro/v1/ base. The username is public config and rides
 * as the X-NITRO-USER companion header. The appliance URL must be HTTPS.
 */
export const netscalerAdcCredential = staticCredential({
  id: "netscalerAdc",
  auth: { kind: "apiKey", header: "X-NITRO-PASS" },
  local: { secret: "password" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.url, "nitro/v1/"),
      methods: ["POST", "DELETE"],
      allowedHeaders: ["X-NITRO-USER"],
    },
  }),
});
