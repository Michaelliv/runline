import { staticCredential } from "../../_shared/credentials.js";

/** An API key, added by the transport as the key field of every JSON call to Mandrill. */
export const mandrillCredential = staticCredential({
  id: "mandrill",
  auth: {
    kind: "static",
    parts: ["key"],
    placements: [{ in: "body", part: "key", name: "key" }],
  },
  local: { key: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://mandrillapp.com/api/1.0/",
      methods: ["POST"],
    },
  },
});
