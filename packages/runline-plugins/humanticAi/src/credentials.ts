import { staticCredential } from "../../_shared/credentials.js";

/** An API key, appended by the transport as the apikey query parameter. */
export const humanticAiCredential = staticCredential({
  id: "humanticAi",
  auth: { kind: "queryKey", param: "apikey" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.humantic.ai/v1/",
      methods: ["GET", "POST"],
    },
  },
});
