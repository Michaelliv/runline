import { staticCredential } from "../../_shared/credentials.js";

/** An API key in the API-Key header, to Pushcut's one API origin. */
export const pushcutCredential = staticCredential({
  id: "pushcut",
  auth: { kind: "apiKey", header: "API-Key" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.pushcut.io/v1/",
      methods: ["GET", "POST"],
    },
  },
  probe: {
    target: "api",
    path: "devices",
    method: "GET",
    acceptedStatuses: [200],
  },
});
