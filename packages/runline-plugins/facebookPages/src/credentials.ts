import { staticCredential } from "runline";
import { GRAPH_VERSION } from "../../_shared/metaGraph.js";

/**
 * A Page access token, sent as a bearer to Meta's Graph API. The token
 * is the Page: `me` beneath this base is the Page it was issued for.
 */
export const facebookPagesCredential = staticCredential({
  id: "facebookPages",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    graph: {
      baseUrl: `https://graph.facebook.com/${GRAPH_VERSION}/`,
      methods: ["GET", "POST", "DELETE"],
    },
  },
  probe: {
    target: "graph",
    path: "me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
