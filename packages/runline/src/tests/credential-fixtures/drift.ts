import drift from "../../../../runline-plugins/drift/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: drift,
  name: "drift",
  config: { accessToken: "drift_secret" },
  secrets: ["accessToken"],
  action: "contact.get",
  input: { contactId: "c1" },
  response: { data: { id: "c1" } },
  target: "api",
  wire: {
    url: "https://driftapi.com/contacts/c1",
    header: ["authorization", "Bearer drift_secret"],
  },
} satisfies CredentialFixture;
