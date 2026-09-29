import { hostLabel, staticCredential } from "../../_shared/credentials.js";

/**
 * The API key as the Basic username, with BambooHR's fixed "x" password,
 * sent to the connection's own company path on the one API gateway host.
 */
export const bambooHrCredential = staticCredential({
  id: "bambooHr",
  auth: { kind: "basic" },
  local: { username: "apiKey", password: { value: "x" } },
  targets: (config) => ({
    api: {
      baseUrl: `https://api.bamboohr.com/api/gateway.php/${hostLabel(config.subdomain)}/v1/`,
      methods: ["GET", "POST", "DELETE"],
    },
  }),
});
