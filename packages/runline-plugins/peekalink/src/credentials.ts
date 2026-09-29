import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API key, sent as the X-API-Key header to Peekalink's origin. The
 * preview endpoint is the bare origin itself, so the target base is /.
 */
export const peekalinkCredential = staticCredential({
  id: "peekalink",
  auth: { kind: "apiKey", header: "X-API-Key" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.peekalink.io/",
      methods: ["POST"],
    },
  },
});
