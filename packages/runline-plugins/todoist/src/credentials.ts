import { staticCredential } from "runline";

/** An API token, sent as a bearer to Todoist's unified API v1. */
export const todoistCredential = staticCredential({
  id: "todoist",
  auth: { kind: "bearer" },
  local: { secret: "apiToken" },
  targets: {
    api: {
      baseUrl: "https://api.todoist.com/api/v1/",
      methods: ["GET", "POST", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "projects",
    method: "GET",
    acceptedStatuses: [200],
  },
});
