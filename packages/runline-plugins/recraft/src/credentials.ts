import { staticCredential } from "../../_shared/credentials.js";

/** An API key as a bearer to Recraft's image generation endpoints. */
export const recraftCredential = staticCredential({
  id: "recraft",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    images: {
      baseUrl: "https://external.api.recraft.ai/v1/images/",
      methods: ["POST"],
    },
  },
});
