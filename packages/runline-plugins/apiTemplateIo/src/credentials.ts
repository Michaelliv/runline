import { staticCredential } from "../../_shared/credentials.js";

/** An API key, sent as the X-API-KEY header to APITemplate.io's one origin. */
export const apiTemplateIoCredential = staticCredential({
  id: "apiTemplateIo",
  auth: { kind: "apiKey", header: "X-API-KEY" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://api.apitemplate.io/v1/",
      methods: ["GET", "POST"],
    },
  },
  probe: {
    target: "api",
    path: "account-information",
    method: "GET",
    acceptedStatuses: [200],
  },
});
