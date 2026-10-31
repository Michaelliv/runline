import woocommerce from "../../../../runline-plugins/woocommerce/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: woocommerce,
  name: "woocommerce",
  config: {
    url: "https://store.example.com",
    consumerKey: "ck_1",
    consumerSecret: "cs_1",
  },
  secrets: ["consumerKey", "consumerSecret"],
  action: "product.get",
  input: { id: "9" },
  response: { id: 9 },
  target: "api",
  wire: {
    url: "https://store.example.com/wp-json/wc/v3/products/9",
    header: ["authorization", "Basic Y2tfMTpjc18x"],
  },
} satisfies CredentialFixture;
