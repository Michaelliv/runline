import { staticCredential } from "../../_shared/credentials.js";

/**
 * A personal API key, sent verbatim in the Authorization header (no
 * scheme prefix) to Linear's one GraphQL origin. Every action is a POST
 * to the `graphql` path beneath it.
 */
export const linearCredential = staticCredential({
  id: "linear",
  auth: { kind: "apiKey", header: "Authorization" },
  local: { secret: "apiKey" },
  targets: {
    gql: {
      baseUrl: "https://api.linear.app/",
      methods: ["POST"],
    },
  },
});
