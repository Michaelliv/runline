import { hostLabel, staticCredential } from "../../_shared/credentials.js";

/**
 * An API key as the Basic username with Freshservice's fixed "X" password,
 * on the connection's own subdomain of freshservice.com.
 */
export const freshserviceCredential = staticCredential({
  id: "freshservice",
  auth: { kind: "basic" },
  local: { username: "apiKey", password: { value: "X" } },
  targets: (config) => ({
    api: {
      baseUrl: `https://${hostLabel(config.domain)}.freshservice.com/api/v2/`,
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
});
