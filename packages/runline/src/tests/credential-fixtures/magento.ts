import magento from "../../../../runline-plugins/magento/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: magento,
  name: "magento",
  config: { host: "https://mystore.example.com", accessToken: "magento_tok" },
  secrets: ["accessToken"],
  action: "customer.get",
  input: { customerId: 7 },
  response: { id: 7 },
  target: "api",
  wire: {
    url: "https://mystore.example.com/rest/default/V1/customers/7",
    header: ["authorization", "Bearer magento_tok"],
  },
} satisfies CredentialFixture;
