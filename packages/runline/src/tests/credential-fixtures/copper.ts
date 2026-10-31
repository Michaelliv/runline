import copper from "../../../../runline-plugins/copper/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: copper,
  name: "copper",
  config: { apiKey: "secret_copper", email: "user@example.com" },
  secrets: ["apiKey"],
  action: "company.get",
  input: { companyId: "c1" },
  response: { id: "c1" },
  target: "api",
  wire: {
    url: "https://api.copper.com/developer_api/v1/companies/c1",
    header: ["x-pw-accesstoken", "secret_copper"],
  },
} satisfies CredentialFixture;
