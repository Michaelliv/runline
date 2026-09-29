import { hostLabel, staticCredential } from "../../_shared/credentials.js";

/** A username-password pair, sent as HTTP Basic to the instance subdomain. */
export const servicenowCredential = staticCredential({
  id: "servicenow",
  auth: { kind: "basic" },
  local: { username: "username", password: "password" },
  targets: (config) => ({
    api: {
      baseUrl: `https://${hostLabel(config.subdomain)}.service-now.com/api/`,
      methods: ["GET", "POST", "PATCH", "DELETE"],
    },
  }),
});
