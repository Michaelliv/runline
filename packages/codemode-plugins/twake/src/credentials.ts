import { staticCredential } from "@shiftlabs/codemode";

/**
 * A workspace API key, sent as a bearer to the one action base Twake
 * serves for outside integrations. `n8n` in the path is Twake's own name
 * for that integration, not this package's.
 */
export const twakeCredential = staticCredential({
  id: "twake",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://plugins.twake.app/plugins/n8n/actions/message/",
      methods: ["POST"],
    },
  },
});
