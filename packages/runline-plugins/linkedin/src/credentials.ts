import { staticCredential } from "../../_shared/credentials.js";

/**
 * An OAuth2 access token, sent as a bearer to LinkedIn's versioned REST
 * origin, with the public Restli protocol and API version headers.
 */
export const linkedinCredential = staticCredential({
  id: "linkedin",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.linkedin.com/rest/",
      methods: ["POST"],
      allowedHeaders: ["X-Restli-Protocol-Version", "LinkedIn-Version"],
    },
  },
});
