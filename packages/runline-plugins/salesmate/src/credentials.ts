import { staticCredential } from "../../_shared/credentials.js";

/**
 * A session token in the sessionToken header, to Salesmate's one API
 * origin. The public workspace linkname rides along as x-linkname.
 */
export const salesmateCredential = staticCredential({
  id: "salesmate",
  auth: { kind: "apiKey", header: "sessionToken" },
  local: { secret: "sessionToken" },
  targets: {
    api: {
      baseUrl: "https://apis.salesmate.io/",
      methods: ["GET", "POST", "PUT", "DELETE"],
      allowedHeaders: ["x-linkname"],
    },
  },
});
