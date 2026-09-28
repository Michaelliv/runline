import { staticCredential } from "../../_shared/credentials.js";

/**
 * A Meta access token, added by the transport as the access_token query
 * parameter on Meta's Graph API host and its video-upload host.
 */
export const facebookGraphCredential = staticCredential({
  id: "facebookGraph",
  auth: { kind: "queryKey", param: "access_token" },
  local: { secret: "accessToken" },
  targets: {
    graph: {
      baseUrl: "https://graph.facebook.com/",
      methods: ["GET", "POST", "DELETE"],
    },
    video: {
      baseUrl: "https://graph-video.facebook.com/",
      methods: ["GET", "POST", "DELETE"],
    },
  },
});
