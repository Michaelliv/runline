import getresponse from "../../../../runline-plugins/getresponse/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: getresponse,
  name: "getresponse",
  config: { apiKey: "gr_key" },
  secrets: ["apiKey"],
  action: "contact.get",
  input: { contactId: "c1" },
  response: { contactId: "c1" },
  target: "api",
  wire: {
    url: "https://api.getresponse.com/v3/contacts/c1",
    header: ["x-auth-token", "api-key gr_key"],
  },
} satisfies CredentialFixture;
