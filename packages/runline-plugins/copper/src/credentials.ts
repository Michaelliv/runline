import { staticCredential } from "../../_shared/credentials.js";

/**
 * A user API key in the X-PW-AccessToken header. Its public companions —
 * X-PW-Application and the user's X-PW-UserEmail — ride as allowed headers.
 */
export const copperCredential = staticCredential({
  id: "copper",
  auth: { kind: "apiKey", header: "X-PW-AccessToken" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.copper.com/developer_api/v1/",
      methods: ["GET", "POST", "PUT", "DELETE"],
      allowedHeaders: ["X-PW-Application", "X-PW-UserEmail"],
    },
  },
});
