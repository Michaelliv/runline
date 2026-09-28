import { staticCredential } from "../../_shared/credentials.js";

/** An access token, sent as a bearer to Dropbox's RPC API origin. */
export const dropboxCredential = staticCredential({
  id: "dropbox",
  auth: { kind: "bearer" },
  local: { secret: "accessToken" },
  targets: {
    api: {
      baseUrl: "https://api.dropboxapi.com/2/",
      methods: ["POST"],
    },
  },
});
