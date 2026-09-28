import { httpsBase, staticCredential } from "../../_shared/credentials.js";

/**
 * The store's consumer key and secret as a Basic pair, beneath the
 * connection's own store URL. The store must be HTTPS.
 */
export const woocommerceCredential = staticCredential({
  id: "woocommerce",
  auth: { kind: "basic" },
  local: { username: "consumerKey", password: "consumerSecret" },
  targets: (config) => ({
    api: {
      baseUrl: httpsBase(config.url, "wp-json/wc/v3/"),
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
});
