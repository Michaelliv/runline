import freshworksCrm from "../../../../runline-plugins/freshworksCrm/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: freshworksCrm,
  name: "freshworksCrm",
  config: { domain: "sub", apiKey: "fw_key" },
  secrets: ["apiKey"],
  action: "contact.get",
  input: { id: 1 },
  response: { contact: { id: 1 } },
  target: "api",
  wire: {
    url: "https://sub.myfreshworks.com/crm/sales/api/contacts/1",
    header: ["authorization", "Token token=fw_key"],
  },
} satisfies CredentialFixture;
