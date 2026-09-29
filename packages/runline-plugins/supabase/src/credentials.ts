import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * The service-role key, sent twice as Supabase requires: as the apikey
 * header and as a bearer, to the project's own PostgREST base beneath
 * /rest/v1/. The project URL is public config and must be HTTPS.
 */
export const supabaseCredential = staticCredential({
  id: "supabase",
  auth: {
    kind: "static",
    parts: ["serviceRole"],
    placements: [
      { in: "header", part: "serviceRole", name: "apikey" },
      {
        in: "header",
        part: "serviceRole",
        name: "Authorization",
        prefix: "Bearer ",
      },
    ],
  },
  local: { serviceRole: "serviceRole" },
  targets: (config) => ({
    rest: {
      baseUrl: httpsBase(config.host, "rest/v1/"),
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: ["Prefer", "Accept-Profile", "Content-Profile"],
    },
  }),
});
