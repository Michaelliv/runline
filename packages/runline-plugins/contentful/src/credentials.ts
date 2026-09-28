import type { CredentialDeclaration } from "runline";
import { configChoice, staticCredential } from "../../_shared/credentials.js";

const delivery = staticCredential({
  id: "contentful",
  auth: { kind: "queryKey", param: "access_token" },
  local: { secret: "deliveryAccessToken" },
  targets: {
    api: { baseUrl: "https://cdn.contentful.com/", methods: ["GET"] },
  },
});

const preview = staticCredential({
  id: "contentful",
  auth: { kind: "queryKey", param: "access_token" },
  local: { secret: "previewAccessToken" },
  targets: {
    api: { baseUrl: "https://preview.contentful.com/", methods: ["GET"] },
  },
});

/**
 * The delivery or preview access token, chosen by the connection's
 * `source`, appended by the transport as access_token on the matching
 * Contentful host. One connection signs one way.
 */
export const contentfulCredential: CredentialDeclaration = (config) =>
  (configChoice(config.source, ["delivery", "preview"], "delivery") ===
    "preview"
    ? preview
    : delivery)(config);
