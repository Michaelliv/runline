import { staticCredential } from "../../_shared/credentials.js";

/** An API token, sent raw in the Authorization header to the GraphQL endpoint. */
export const mondayCredential = staticCredential({
  id: "monday",
  auth: { kind: "apiKey", header: "Authorization" },
  local: { secret: "apiToken" },
  targets: {
    api: {
      baseUrl: "https://api.monday.com/v2/",
      methods: ["POST"],
      allowedHeaders: ["API-Version"],
    },
  },
});
