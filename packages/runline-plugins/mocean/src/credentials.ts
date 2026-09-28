import { staticCredential } from "../../_shared/credentials.js";

/** An API key and secret, added by the transport as the mocean-api-key and mocean-api-secret fields of every Mocean form. */
export const moceanCredential = staticCredential({
  id: "mocean",
  auth: {
    kind: "static",
    parts: ["key", "secret"],
    placements: [
      { in: "body", part: "key", name: "mocean-api-key" },
      { in: "body", part: "secret", name: "mocean-api-secret" },
    ],
  },
  local: { key: "apiKey", secret: "apiSecret" },
  targets: {
    api: { baseUrl: "https://rest.moceanapi.com/rest/2/", methods: ["POST"] },
  },
});
