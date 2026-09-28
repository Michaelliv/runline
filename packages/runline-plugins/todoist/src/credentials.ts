import { staticCredential } from "../../_shared/credentials.js";

/**
 * An API token, sent as a bearer to Todoist's REST v2 and Sync v9
 * surfaces on the one API origin.
 */
export const todoistCredential = staticCredential({
  id: "todoist",
  auth: { kind: "bearer" },
  local: { secret: "apiToken" },
  targets: {
    rest: {
      baseUrl: "https://api.todoist.com/rest/v2/",
      methods: ["GET", "POST", "DELETE"],
    },
    sync: {
      baseUrl: "https://api.todoist.com/sync/v9/",
      methods: ["POST"],
    },
  },
  probe: {
    target: "rest",
    path: "projects",
    method: "GET",
    acceptedStatuses: [200],
  },
});
