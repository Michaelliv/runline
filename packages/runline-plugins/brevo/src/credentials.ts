import { staticCredential } from "../../_shared/credentials.js";

/** An API key, sent as the api-key header to Brevo's v3 API base. */
export const brevoCredential = staticCredential({
  id: "brevo",
  auth: { kind: "apiKey", header: "api-key" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.brevo.com/v3/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "account",
    method: "GET",
    acceptedStatuses: [200],
  },
});
