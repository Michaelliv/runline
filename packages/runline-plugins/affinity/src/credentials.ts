import { staticCredential } from "../../_shared/credentials.js";

/** An API key as the Basic password, with an empty username, to Affinity's one origin. */
export const affinityCredential = staticCredential({
  id: "affinity",
  auth: { kind: "basic" },
  local: { username: { value: "" }, password: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.affinity.co/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "auth/whoami",
    method: "GET",
    acceptedStatuses: [200],
  },
});
