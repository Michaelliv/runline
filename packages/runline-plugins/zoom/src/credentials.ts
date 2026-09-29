import { staticCredential } from "../../_shared/credentials.js";

/** An access token, sent as a bearer to Zoom's one API origin. */
export const zoomCredential = staticCredential({
  id: "zoom",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.zoom.us/v2/",
      methods: ["GET", "POST", "PATCH", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "users/me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
