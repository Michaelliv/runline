import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API key, sent as the X-Api-Key header to seven's gateway. SentWith
 * is the public client-name companion header seven asks integrators for.
 */
export const sms77Credential = staticCredential({
  id: "sms77",
  auth: { kind: "apiKey", header: "X-Api-Key" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://gateway.seven.io/api/",
      methods: ["POST"],
      allowedHeaders: ["SentWith"],
    },
  },
});
