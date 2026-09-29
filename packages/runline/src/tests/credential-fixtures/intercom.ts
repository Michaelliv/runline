import intercom from "../../../../runline-plugins/intercom/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: intercom,
  name: "intercom",
  config: { accessToken: "intercom_tok" },
  secrets: ["accessToken"],
  action: "contact.get",
  input: { contactId: "c1" },
  response: { id: "c1" },
  target: "api",
  wire: {
    url: "https://api.intercom.io/contacts/c1",
    header: ["authorization", "Bearer intercom_tok"],
  },
} satisfies CredentialFixture;
