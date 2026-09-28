import { staticCredential } from "../../_shared/credentials.js";

/** An API key as a bearer to Lingvanex's one translate endpoint. */
export const lingvanexCredential = staticCredential({
  id: "lingvanex",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api-b2b.backenster.com/b1/api/v3/",
      methods: ["POST"],
    },
  },
});
