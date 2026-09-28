import { staticCredential } from "../../_shared/credentials.js";

/**
 * A Content Delivery token, appended as the token query parameter on the
 * content API, and a Management API token, sent in Authorization on the
 * management API. A connection may hold either or both; a call to an API
 * whose token it lacks is refused.
 */
export const storyblokCredential = staticCredential({
  id: "storyblok",
  auth: {
    kind: "static",
    parts: ["contentToken", "managementToken"],
    optionalParts: ["contentToken", "managementToken"],
    placements: [
      {
        in: "query",
        part: "contentToken",
        name: "token",
        targets: ["content"],
      },
      {
        in: "header",
        part: "managementToken",
        name: "Authorization",
        targets: ["management"],
      },
    ],
  },
  local: { contentToken: "contentToken", managementToken: "managementToken" },
  targets: {
    content: { baseUrl: "https://api.storyblok.com/v1/cdn/", methods: ["GET"] },
    management: {
      baseUrl: "https://mapi.storyblok.com/v1/spaces/",
      methods: ["GET", "DELETE"],
    },
  },
});
