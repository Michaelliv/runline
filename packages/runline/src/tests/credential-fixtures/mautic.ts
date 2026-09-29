import mautic from "../../../../runline-plugins/mautic/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: mautic,
  name: "mautic",
  config: {
    url: "https://mautic.example.com",
    username: "mautic_user",
    password: "mautic_pass",
  },
  secrets: ["username", "password"],
  action: "contact.get",
  input: { contactId: "7" },
  response: { contact: { id: 7 } },
  target: "api",
  wire: {
    url: "https://mautic.example.com/api/contacts/7",
    header: ["authorization", "Basic bWF1dGljX3VzZXI6bWF1dGljX3Bhc3M="],
  },
} satisfies CredentialFixture;
