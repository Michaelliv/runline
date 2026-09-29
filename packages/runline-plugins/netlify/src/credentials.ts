import { staticCredential } from "../../_shared/credentials.js";

/** A personal access token, sent as a bearer to Netlify's one API origin. */
export const netlifyCredential = staticCredential({
  id: "netlify",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.netlify.com/api/v1/",
      methods: ["GET", "POST", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "user",
    method: "GET",
    acceptedStatuses: [200],
  },
});
