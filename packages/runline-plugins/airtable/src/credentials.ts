import { staticCredential } from "../../_shared/credentials.js";

/** A personal access token, sent as a bearer to Airtable's one API origin. */
export const airtableCredential = staticCredential({
  id: "airtable",
  auth: { kind: "bearer" },
  local: { secret: "token" },
  targets: {
    api: {
      baseUrl: "https://api.airtable.com/v0/",
      methods: ["GET", "POST", "PATCH", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "meta/whoami",
    method: "GET",
    acceptedStatuses: [200],
  },
});
