import shopify from "../../../../runline-plugins/shopify/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: shopify,
  name: "shopify",
  config: { shopSubdomain: "mystore", accessToken: "secret_shopify" },
  secrets: ["accessToken"],
  action: "order.get",
  input: { orderId: "1" },
  response: { order: { id: 1 } },
  target: "api",
  wire: {
    url: "https://mystore.myshopify.com/admin/api/2024-07/orders/1.json",
    header: ["x-shopify-access-token", "secret_shopify"],
  },
} satisfies CredentialFixture;
