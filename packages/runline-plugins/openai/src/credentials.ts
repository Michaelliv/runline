import { staticCredential } from "runline";

/** An API key, sent as a bearer to OpenAI's images API base. */
export const openaiCredential = staticCredential({
  id: "openai",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.openai.com/v1/images/",
      methods: ["POST"],
    },
  },
});
