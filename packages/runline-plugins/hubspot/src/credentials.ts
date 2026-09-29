import { staticCredential } from "../../_shared/credentials.js";

/**
 * A private-app access token, sent as a bearer to HubSpot's one API
 * origin: CRM v3 objects, legacy v1 lists and engagements, and forms.
 */
export const hubspotCredential = staticCredential({
  id: "hubspot",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.hubapi.com/",
      methods: ["GET", "POST", "PATCH", "DELETE"],
    },
  },
});
