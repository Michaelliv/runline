import { staticCredential } from "../../_shared/credentials.js";

/** The account email and API key as the Basic pair, to uProc's one
 *  process endpoint. */
export const uprocCredential = staticCredential({
  id: "uproc",
  auth: { kind: "basic" },
  local: { username: "email", password: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.uproc.io/api/v2/",
      methods: ["POST"],
    },
  },
});
