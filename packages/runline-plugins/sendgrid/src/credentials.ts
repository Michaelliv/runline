import { staticCredential } from "../../_shared/credentials.js";

/** An API key, sent as a bearer to SendGrid's v3 API. */
export const sendgridCredential = staticCredential({
  id: "sendgrid",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.sendgrid.com/v3/",
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    },
  },
});
