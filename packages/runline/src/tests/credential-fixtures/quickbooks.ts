import quickbooks from "../../../../runline-plugins/quickbooks/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: quickbooks,
  name: "quickbooks",
  config: { accessToken: "qbo_token", companyId: "123" },
  secrets: ["accessToken"],
  action: "customer.get",
  input: { id: "9" },
  response: { Customer: { Id: "9" } },
  target: "api",
  wire: {
    url: "https://quickbooks.api.intuit.com/v3/company/123/customer/9",
    header: ["authorization", "Bearer qbo_token"],
  },
} satisfies CredentialFixture;
