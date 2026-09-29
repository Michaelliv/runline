import { staticCredential } from "../../_shared/credentials.js";

/**
 * The API key pair, sent as HTTP Basic to the v3.1 email API, and an
 * optional SMS token, sent as a bearer to the v4 SMS API. A connection
 * without the SMS token is refused on the SMS API.
 */
export const mailjetCredential = staticCredential({
  id: "mailjet",
  auth: {
    kind: "static",
    parts: ["publicKey", "privateKey", "smsToken"],
    optionalParts: ["smsToken"],
    placements: [
      {
        in: "basic",
        username: "publicKey",
        password: "privateKey",
        targets: ["email"],
      },
      {
        in: "header",
        part: "smsToken",
        name: "Authorization",
        prefix: "Bearer ",
        targets: ["sms"],
      },
    ],
  },
  local: {
    publicKey: "apiKeyPublic",
    privateKey: "apiKeyPrivate",
    smsToken: "smsToken",
  },
  targets: {
    email: { baseUrl: "https://api.mailjet.com/v3.1/", methods: ["POST"] },
    sms: { baseUrl: "https://api.mailjet.com/v4/", methods: ["POST"] },
  },
});
