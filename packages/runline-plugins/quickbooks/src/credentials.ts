import { hostLabel, staticCredential } from "../../_shared/credentials.js";

/** An OAuth2 access token, sent as a bearer to the company's own realm path on
 *  Intuit's production or sandbox host, chosen by the sandbox flag. */
export const quickbooksCredential = staticCredential({
  id: "quickbooks",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: (config) => ({
    api: {
      baseUrl: `${
        config.sandbox === true
          ? "https://sandbox-quickbooks.api.intuit.com"
          : "https://quickbooks.api.intuit.com"
      }/v3/company/${hostLabel(config.companyId)}/`,
      methods: ["GET", "POST"],
    },
  }),
  probe: {
    target: "api",
    path: "query?query=select%20*%20from%20CompanyInfo",
    method: "GET",
    acceptedStatuses: [200],
  },
});
