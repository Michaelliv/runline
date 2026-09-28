import { staticCredential } from "../../_shared/credentials.js";

/** An account API key, sent as the Apikey header to E-goi's one API origin. */
export const egoiCredential = staticCredential({
  id: "egoi",
  auth: { kind: "apiKey", header: "Apikey" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.egoiapp.com/",
      methods: ["GET", "POST", "PATCH"],
    },
  },
  probe: {
    target: "api",
    path: "my-account",
    method: "GET",
    acceptedStatuses: [200],
  },
});
