import { staticCredential } from "../../_shared/credentials.js";

/** A personal API key in the api-key header, to Stackby's one API origin. */
export const stackbyCredential = staticCredential({
  id: "stackby",
  auth: { kind: "apiKey", header: "api-key" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://stackby.com/api/betav1/",
      methods: ["GET", "POST", "DELETE"],
    },
  },
});
