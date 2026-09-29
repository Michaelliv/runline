import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * An application token that sends messages and a client token that reads
 * and deletes them, each in the X-Gotify-Key header on its own target of
 * the connection's HTTPS server.
 */
export const gotifyCredential = staticCredential({
  id: "gotify",
  auth: {
    kind: "static",
    parts: ["appToken", "clientToken"],
    placements: [
      {
        in: "header",
        part: "appToken",
        name: "X-Gotify-Key",
        targets: ["app"],
      },
      {
        in: "header",
        part: "clientToken",
        name: "X-Gotify-Key",
        targets: ["client"],
      },
    ],
  },
  local: { appToken: "appApiToken", clientToken: "clientApiToken" },
  targets: (config) => ({
    app: { baseUrl: httpsBase(config.url, ""), methods: ["POST"] },
    client: { baseUrl: httpsBase(config.url, ""), methods: ["GET", "DELETE"] },
  }),
});
