import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API key, sent as a bearer to Together's v1 image generations
 * endpoint — the only path this plugin calls.
 */
export const togetherCredential = staticCredential({
  id: "together",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.together.xyz/v1/",
      methods: ["POST"],
    },
  },
});
