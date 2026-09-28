import { staticCredential } from "../../_shared/credentials.js";

/** An auth token, added by the transport as the auth_token field of every Vero form. */
export const veroCredential = staticCredential({
  id: "vero",
  auth: {
    kind: "static",
    parts: ["token"],
    placements: [{ in: "body", part: "token", name: "auth_token" }],
  },
  local: { token: "authToken" },
  targets: {
    api: {
      baseUrl: "https://api.getvero.com/api/v2/",
      methods: ["POST", "PUT"],
    },
  },
});
