import { staticCredential } from "../../_shared/credentials.js";

/** An API key, sent as the autopilotapikey header to Autopilot's one origin. */
export const autopilotCredential = staticCredential({
  id: "autopilot",
  auth: { kind: "apiKey", header: "autopilotapikey" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api2.autopilothq.com/v1/",
      methods: ["GET", "POST", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "lists",
    method: "GET",
    acceptedStatuses: [200],
  },
});
