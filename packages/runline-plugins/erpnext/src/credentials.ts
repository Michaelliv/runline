import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * The API key and secret joined as `token {apiKey}:{apiSecret}` in the
 * Authorization header, on the configured instance's own /api/ base. The
 * host is public config and must be HTTPS.
 */
export const erpnextCredential = staticCredential({
  id: "erpnext",
  auth: { kind: "apiKey", header: "Authorization", prefix: "token " },
  local: {
    secret: {
      concat: [{ field: "apiKey" }, { value: ":" }, { field: "apiSecret" }],
    },
  },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.host, "api/"),
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
  probe: {
    target: "api",
    path: "method/frappe.auth.get_logged_user",
    method: "GET",
    acceptedStatuses: [200],
  },
});
