import { staticCredential } from "../../_shared/credentials.js";

/**
 * A user-subject Shift CRM API key, sent as a bearer and pinned to the
 * /v1/crm surface of the Shift cloud origin.
 */
export const shiftCrmCredential = staticCredential({
  id: "shiftCrm",
  auth: { kind: "bearer" },
  local: { secret: "apiKey" },
  targets: {
    api: {
      baseUrl: "https://cloud.shift-labs.ai/v1/crm/",
      methods: ["GET", "POST", "PATCH", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "access/me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
