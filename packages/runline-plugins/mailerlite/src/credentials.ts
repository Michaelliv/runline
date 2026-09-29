import { staticCredential } from "../../_shared/credentials.js";

/** An API token, sent as a bearer to MailerLite's connect API origin. */
export const mailerliteCredential = staticCredential({
  id: "mailerlite",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://connect.mailerlite.com/api/",
      methods: ["GET", "POST", "PUT"],
    },
  },
});
