import { staticCredential } from "../../_shared/credentials.js";

/** An OAuth2 user token, sent as a bearer to Spotify's one API origin. */
export const spotifyCredential = staticCredential({
  id: "spotify",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.spotify.com/v1/",
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  },
  probe: {
    target: "api",
    path: "me",
    method: "GET",
    acceptedStatuses: [200],
  },
});
