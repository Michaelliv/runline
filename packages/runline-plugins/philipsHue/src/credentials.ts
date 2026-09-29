import { staticCredential } from "../../_shared/credentials.js";

/**
 * An OAuth2 access token, sent as a bearer to the Hue remote API. The
 * bridge username is public config and rides in the request path beneath
 * the target, never in the declaration.
 */
export const philipsHueCredential = staticCredential({
  id: "philipsHue",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.meethue.com/route/",
      methods: ["GET", "PUT", "DELETE"],
    },
  },
});
