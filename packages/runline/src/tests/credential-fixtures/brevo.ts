import brevo from "../../../../runline-plugins/brevo/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: brevo,
  name: "brevo",
  config: { apiKey: "brevo_key" },
  secrets: ["apiKey"],
  action: "contact.get",
  input: { identifier: "jane@example.com" },
  response: { email: "jane@example.com" },
  target: "api",
  wire: {
    url: "https://api.brevo.com/v3/contacts/jane%40example.com",
    header: ["api-key", "brevo_key"],
  },
} satisfies CredentialFixture;
