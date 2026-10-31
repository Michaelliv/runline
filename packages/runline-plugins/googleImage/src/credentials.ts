import { staticCredential } from "runline";

/** A Google AI API key, appended by the transport as the `key` query
 *  parameter on the Generative Language API. */
export const googleImageCredential = staticCredential({
  id: "googleImage",
  auth: { kind: "queryKey", param: "key" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/",
      methods: ["POST"],
    },
  },
});
