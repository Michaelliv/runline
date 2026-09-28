import { staticCredential } from "../../_shared/credentials.js";

/** The auth key, appended by the transport as the authkey query parameter. */
export const msg91Credential = staticCredential({
  id: "msg91",
  auth: { kind: "queryKey", param: "authkey" },
  local: { secret: "authkey" },
  targets: {
    api: { baseUrl: "https://api.msg91.com/api/", methods: ["GET"] },
  },
});
