import unleashedSoftware from "../../../../runline-plugins/unleashedSoftware/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: unleashedSoftware,
  name: "unleashedSoftware",
  config: { apiId: "ul_id", apiKey: "ul_key" },
  secrets: ["apiId", "apiKey"],
  action: "stockOnHand.get",
  input: { productId: "p1" },
  response: {},
  target: "api",
  wire: {
    url: "https://api.unleashedsoftware.com/StockOnHand/p1",
    header: ["api-auth-id", "ul_id"],
  },
} satisfies CredentialFixture;
