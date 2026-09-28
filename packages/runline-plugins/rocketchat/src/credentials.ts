import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * A personal auth token in the X-Auth-Token header. Its public companion,
 * the X-User-Id identifier, rides as an allowed header.
 */
export const rocketchatCredential = staticCredential({
  id: "rocketchat",
  auth: { kind: "apiKey", header: "X-Auth-Token" },
  local: { secret: "authToken" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.domain, "api/v1/"),
      methods: ["POST"],
      allowedHeaders: ["X-User-Id"],
    },
  }),
});
