import agileCrm from "../../../../runline-plugins/agileCrm/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: agileCrm,
  name: "agileCrm",
  config: { subdomain: "sub", email: "user@example.com", apiKey: "agile_key" },
  secrets: ["email", "apiKey"],
  action: "contact.get",
  input: { contactId: "c1" },
  response: { id: "c1" },
  target: "api",
  wire: {
    url: "https://sub.agilecrm.com/dev/api/contacts/c1",
    header: ["authorization", "Basic dXNlckBleGFtcGxlLmNvbTphZ2lsZV9rZXk="],
  },
} satisfies CredentialFixture;
