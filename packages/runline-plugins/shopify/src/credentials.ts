import { hostLabel, staticCredential } from "../../_shared/credentials.js";

/** The store's Admin API base; also the boundary next-page links must stay in. */
export function shopifyBase(config: Readonly<Record<string, unknown>>): string {
  return `https://${hostLabel(config.shopSubdomain)}.myshopify.com/admin/api/2024-07/`;
}

/**
 * An Admin API access token, sent as the X-Shopify-Access-Token header to
 * the store's own myshopify.com host beneath /admin/api/2024-07/.
 */
export const shopifyCredential = staticCredential({
  id: "shopify",
  auth: { kind: "apiKey", header: "X-Shopify-Access-Token" },
  local: { secret: "accessToken" },
  targets: (config) => ({
    api: {
      baseUrl: shopifyBase(config),
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
  }),
});
