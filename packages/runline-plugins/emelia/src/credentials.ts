import { staticCredential } from "../../_shared/credentials.js";

/** An API key, sent raw (no scheme) on the Authorization header to Emelia's
 *  one GraphQL endpoint. */
export const emeliaCredential = staticCredential({
  id: "emelia",
  auth: { kind: "apiKey", header: "Authorization" },
  local: { secret: "apiKey" },
  targets: {
    gql: {
      baseUrl: "https://graphql.emelia.io/",
      methods: ["POST"],
    },
  },
});
