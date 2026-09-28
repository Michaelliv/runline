import { staticCredential } from "../../_shared/credentials.js";

/**
 * The vendor ID and auth code, added by the transport as the vendor_id and
 * vendor_auth_code fields of every JSON call. Stored together, so a code
 * is never sent under another vendor. `sandbox` selects Paddle's sandbox
 * host.
 */
export const paddleCredential = staticCredential({
  id: "paddle",
  auth: {
    kind: "static",
    parts: ["vendorId", "authCode"],
    placements: [
      { in: "body", part: "vendorId", name: "vendor_id" },
      { in: "body", part: "authCode", name: "vendor_auth_code" },
    ],
  },
  local: { vendorId: "vendorId", authCode: "vendorAuthCode" },
  targets: (config) => ({
    api: {
      baseUrl:
        config.sandbox === true
          ? "https://sandbox-vendors.paddle.com/api/"
          : "https://vendors.paddle.com/api/",
      methods: ["POST"],
    },
  }),
});
