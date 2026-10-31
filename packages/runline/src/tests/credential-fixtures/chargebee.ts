import chargebee from "../../../../runline-plugins/chargebee/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: chargebee,
  name: "chargebee",
  config: { accountName: "mysite", apiKey: "secret_chargebee" },
  secrets: ["apiKey"],
  action: "invoice.list",
  input: {},
  response: { list: [] },
  target: "api",
  wire: {
    url: "https://mysite.chargebee.com/api/v2/invoices?limit=10&sort_by%5Bdesc%5D=date",
    header: ["authorization", "Basic c2VjcmV0X2NoYXJnZWJlZTo="],
  },
} satisfies CredentialFixture;
