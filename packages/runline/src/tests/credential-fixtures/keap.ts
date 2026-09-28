import keap from "../../../../runline-plugins/keap/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: keap,
  name: "keap",
  config: { accessToken: "secret_keap" },
  secrets: ["accessToken"],
  action: "contact.get",
  input: { contactId: 7 },
  response: { id: 7 },
  target: "api",
  wire: {
    url: "https://api.infusionsoft.com/crm/rest/v1/contacts/7",
    header: ["authorization", "Bearer secret_keap"],
  },
} satisfies CredentialFixture;
