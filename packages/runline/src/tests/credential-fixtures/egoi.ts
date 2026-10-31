import egoi from "../../../../runline-plugins/egoi/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: egoi,
  name: "egoi",
  config: { apiKey: "secret_egoi" },
  secrets: ["apiKey"],
  action: "contact.get",
  input: { listId: "l1", contactId: "c1" },
  response: { contact_id: "c1" },
  target: "api",
  wire: {
    url: "https://api.egoiapp.com/lists/l1/contacts/c1",
    header: ["apikey", "secret_egoi"],
  },
} satisfies CredentialFixture;
