import { staticCredential } from "../../_shared/credentials.js";

export const NOTION_VERSION = "2021-08-16";

/** An integration token, sent as a bearer to Notion's one API origin. */
export const notionCredential = staticCredential({
  id: "notion",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.notion.com/v1/",
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: ["Notion-Version"],
    },
  },
  probe: {
    target: "api",
    path: "users/me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
