import { staticCredential } from "../../_shared/credentials.js";

/** An API key, sent as the X-Access-Token header to Dropcontact's one API origin. */
export const dropcontactCredential = staticCredential({
  id: "dropcontact",
  auth: { kind: "apiKey", header: "X-Access-Token" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.dropcontact.io/",
      methods: ["GET", "POST"],
    },
  },
});
