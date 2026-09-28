import { staticCredential } from "../../_shared/credentials.js";

/** An API key and secret, added by the transport as the api_key and api_secret fields of Vonage's SMS form. */
export const vonageCredential = staticCredential({
  id: "vonage",
  auth: {
    kind: "static",
    parts: ["key", "secret"],
    placements: [
      { in: "body", part: "key", name: "api_key" },
      { in: "body", part: "secret", name: "api_secret" },
    ],
  },
  local: { key: "apiKey", secret: "apiSecret" },
  targets: {
    sms: { baseUrl: "https://rest.nexmo.com/sms/", methods: ["POST"] },
  },
});
