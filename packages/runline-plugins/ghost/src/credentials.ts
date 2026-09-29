import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * An Admin API key (`<id>:<hex secret>`), from which the transport signs a
 * fresh five-minute JWT for every request, sent as `Authorization: Ghost
 * <token>` to the site's unversioned Admin API base. The site URL is
 * public config and must be HTTPS.
 */
export const ghostCredential = staticCredential({
  id: "ghost",
  auth: {
    kind: "static",
    parts: ["adminKey"],
    placements: [
      {
        in: "jwt",
        part: "adminKey",
        name: "Authorization",
        prefix: "Ghost ",
        audience: "/admin/",
      },
    ],
  },
  local: { adminKey: "adminApiKey" },
  targets: (config) => ({
    admin: {
      baseUrl: httpsBase(config.url, "ghost/api/admin/"),
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
  probe: {
    target: "admin",
    path: "site/",
    method: "GET",
    acceptedStatuses: [200],
  },
});
