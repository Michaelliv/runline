import { staticCredential } from "../../_shared/credentials.js";

/** The API version header every HighLevel request carries. */
export const HIGHLEVEL_VERSION = "2021-07-28";

/**
 * An OAuth2 access token, sent as a bearer to HighLevel's one API origin.
 * The Version header is a public API-version marker, not a credential.
 */
export const highlevelCredential = staticCredential({
  id: "highlevel",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://services.leadconnectorhq.com/",
      methods: ["GET", "POST", "PUT", "DELETE"],
      allowedHeaders: ["Version"],
    },
  },
});
