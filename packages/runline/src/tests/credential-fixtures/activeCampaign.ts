import activeCampaign from "../../../../runline-plugins/activeCampaign/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: activeCampaign,
  name: "activeCampaign",
  config: {
    apiUrl: "https://myaccount.api-us1.com",
    apiKey: "secret_activecampaign",
  },
  secrets: ["apiKey"],
  action: "contact.get",
  input: { contactId: "c1" },
  response: { contact: { id: "c1" } },
  target: "api",
  wire: {
    url: "https://myaccount.api-us1.com/api/3/contacts/c1",
    header: ["api-token", "secret_activecampaign"],
  },
} satisfies CredentialFixture;
