import { staticCredential } from "../../_shared/credentials.js";

/** The API key as the Basic password with an empty username. */
export const lemlistCredential = staticCredential({
  id: "lemlist",
  auth: { kind: "basic" },
  local: { username: { value: "" }, password: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.lemlist.com/api/",
      methods: ["GET", "POST", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "team",
    method: "GET",
    acceptedStatuses: [200],
  },
});
