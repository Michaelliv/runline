import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * The user's password or API key, which Odoo's JSON-RPC takes as the third
 * argument of every call; the plugin leaves that slot null and the
 * transport fills it. The instance URL is public config and must be HTTPS;
 * the username and database are public config too.
 */
export const odooCredential = staticCredential({
  id: "odoo",
  auth: {
    kind: "static",
    parts: ["password"],
    placements: [
      { in: "jsonPointer", part: "password", pointer: "/params/args/2" },
    ],
  },
  local: { password: "password" },
  targets: (config) => ({
    rpc: { baseUrl: httpsBase(config.url, ""), methods: ["POST"] },
  }),
});
