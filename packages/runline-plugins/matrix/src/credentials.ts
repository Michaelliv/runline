import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/** An access token, sent as a bearer to the configured homeserver's client API. */
export const matrixCredential = staticCredential({
  id: "matrix",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.homeserverUrl, "_matrix/client/r0/"),
      methods: ["GET", "POST", "PUT"],
    },
  }),
  probe: {
    target: "api",
    path: "account/whoami",
    method: "GET",
    acceptedStatuses: [200],
  },
});
