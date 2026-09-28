import { staticCredential } from "../../_shared/credentials.js";

/** An API key, sent as a bearer to xAI's one API origin. */
export const xaiCredential = staticCredential({
  id: "xai",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.x.ai/v1/",
      methods: ["POST"],
    },
  },
});
