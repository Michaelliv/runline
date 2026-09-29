import { staticCredential } from "../../_shared/credentials.js";

/** An OAuth2 access token, sent as a bearer to Strava's one API origin. */
export const stravaCredential = staticCredential({
  id: "strava",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://www.strava.com/api/v3/",
      methods: ["GET", "POST", "PUT"],
    },
  },
  probe: {
    target: "api",
    path: "athlete",
    method: "GET",
    acceptedStatuses: [200],
  },
});
