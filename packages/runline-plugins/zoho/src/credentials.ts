import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * An OAuth2 access token, sent as `Authorization: Zoho-oauthtoken …` to the
 * CRM API on the connection's data-center domain.
 */
export const zohoCredential = staticCredential({
  id: "zoho",
  auth: { kind: "apiKey", header: "Authorization", prefix: "Zoho-oauthtoken " },
  local: { secret: "accessToken" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(
        (typeof config.apiDomain === "string" && config.apiDomain) ||
          "https://www.zohoapis.com",
        "crm/v2/",
      ),
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
});
