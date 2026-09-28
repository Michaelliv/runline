import { hostLabel, staticCredential } from "../../_shared/credentials.js";

/**
 * A site API key as the Basic username with an empty password, to the
 * account's own Chargebee site beneath /api/v2/.
 */
export const chargebeeCredential = staticCredential({
  id: "chargebee",
  auth: { kind: "basic" },
  local: { username: "apiKey", password: { value: "" } },
  targets: (config) => ({
    api: {
      baseUrl: `https://${hostLabel(config.accountName)}.chargebee.com/api/v2/`,
      methods: ["GET", "POST"],
    },
  }),
});
