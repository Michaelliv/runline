import { staticCredential } from "../../_shared/credentials.js";

/**
 * An optional API key, sent in the X-API-Key header to FXMacroData's v1
 * REST base; without one, requests go unsigned and reach the free tier
 * (USD releases, the USD calendar and every currency's data catalogue).
 * The probe reads one non-USD row, which only a valid key can do.
 */
export const fxmacrodataCredential = staticCredential({
  id: "fxmacrodata",
  auth: { kind: "apiKey", header: "X-API-Key" },
  local: { secret: "apiKey" },
  optional: true,
  targets: {
    api: { baseUrl: "https://api.fxmacrodata.com/v1/", methods: ["GET"] },
  },
  probe: {
    target: "api",
    path: "announcements/eur/policy_rate?limit=1",
    method: "GET",
    acceptedStatuses: [200],
  },
});
