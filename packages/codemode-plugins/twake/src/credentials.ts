import { staticCredential } from "@shiftlabs/codemode";

/**
 * A workspace API key, sent as a bearer to Twake's one codemode plugin
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
