import hubspot from "../../../../runline-plugins/hubspot/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: hubspot,
  name: "hubspot",
  config: { accessToken: "hs_secret" },
  secrets: ["accessToken"],
  action: "contact.get",
  input: { id: "c1" },
  response: { id: "c1" },
  target: "api",
  wire: {
    url: "https://api.hubapi.com/crm/v3/objects/contacts/c1",
    header: ["authorization", "Bearer hs_secret"],
  },
} satisfies CredentialFixture;
