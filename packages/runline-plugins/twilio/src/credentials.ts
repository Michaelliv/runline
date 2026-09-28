import { staticCredential } from "../../_shared/credentials.js";

/**
 * The account SID and auth token: the SID is both the Basic username and
 * the account segment of every path, so one stored part serves both.
 */
export const twilioCredential = staticCredential({
  id: "twilio",
  auth: {
    kind: "static",
    parts: ["accountSid", "authToken"],
    placements: [
      { in: "path", part: "accountSid" },
      { in: "basic", username: "accountSid", password: "authToken" },
    ],
  },
  local: { accountSid: "accountSid", authToken: "authToken" },
  targets: {
    api: {
      baseUrl: "https://api.twilio.com/2010-04-01/Accounts/",
      methods: ["POST"],
    },
  },
});
