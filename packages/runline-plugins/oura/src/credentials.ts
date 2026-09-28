import { staticCredential } from "../../_shared/credentials.js";

/** A personal access token, sent as a bearer to Oura's one API origin. */
export const ouraCredential = staticCredential({
  id: "oura",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.ouraring.com/v2/",
      methods: ["GET"],
    },
  },
  probe: {
    target: "api",
    path: "usercollection/personal_info",
    method: "GET",
    acceptedStatuses: [200],
  },
});
