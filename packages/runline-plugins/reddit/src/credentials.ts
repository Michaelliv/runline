import { staticCredential } from "../../_shared/credentials.js";

/**
 * An optional OAuth2 access token, sent as a bearer to oauth.reddit.com;
 * without one, public reads go unsigned to www.reddit.com.
 */
export const redditCredential = staticCredential({
  id: "reddit",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  optional: {
    targets: {
      api: {
        baseUrl: "https://www.reddit.com/",
        methods: ["GET"],
        allowedHeaders: ["User-Agent"],
      },
    },
  },
  targets: {
    api: {
      baseUrl: "https://oauth.reddit.com/",
      methods: ["GET", "POST"],
      allowedHeaders: ["User-Agent"],
    },
  },
});
