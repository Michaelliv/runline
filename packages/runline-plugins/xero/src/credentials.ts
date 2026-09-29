import { staticCredential } from "../../_shared/credentials.js";

/**
 * An OAuth2 access token, sent as a bearer to Xero's accounting API. The
 * public Xero-tenant-id companion header names the organization.
 */
export const xeroCredential = staticCredential({
  id: "xero",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.xero.com/api.xro/2.0/",
      methods: ["GET", "POST"],
      allowedHeaders: ["Xero-tenant-id"],
    },
  },
});
