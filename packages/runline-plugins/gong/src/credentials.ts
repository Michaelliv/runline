import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * An access key and secret as the Basic pair, on the connection's Gong
 * API base (api.gong.io, or the account's regional base) beneath /v2/.
 */
export const gongCredential = staticCredential({
  id: "gong",
  auth: { kind: "basic" },
  local: { username: "accessKey", password: "accessKeySecret" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.baseUrl ?? "https://api.gong.io", "v2/"),
      methods: ["POST"],
    },
  }),
});
