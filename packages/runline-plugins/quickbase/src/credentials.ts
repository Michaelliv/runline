import { staticCredential } from "../../_shared/credentials.js";

/** A user token, sent as "QB-USER-TOKEN {token}" in Authorization, to QuickBase's
 *  one API origin. The realm hostname rides along as a public caller header. */
export const quickbaseCredential = staticCredential({
  id: "quickbase",
  auth: { kind: "apiKey", header: "Authorization", prefix: "QB-USER-TOKEN " },
  local: { secret: "userToken" },
  targets: {
    api: {
      baseUrl: "https://api.quickbase.com/v1/",
      methods: ["GET", "POST", "DELETE"],
      allowedHeaders: ["QB-Realm-Hostname"],
    },
  },
});
