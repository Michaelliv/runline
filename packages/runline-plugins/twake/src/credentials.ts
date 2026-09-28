import { staticCredential } from "../../_shared/credentials.js";

/**
 * A workspace API key, sent as a bearer to Twake's one runline plugin
 * action base.
 */
export const twakeCredential = staticCredential({
  id: "twake",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://plugins.twake.app/plugins/runline/actions/message/",
      methods: ["POST"],
    },
  },
});
