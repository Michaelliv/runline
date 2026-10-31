import zoho from "../../../../runline-plugins/zoho/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: zoho,
  name: "zoho",
  config: { accessToken: "secret_zoho" },
  secrets: ["accessToken"],
  action: "contact.get",
  input: { id: "c1" },
  response: { data: [{ id: "c1" }] },
  target: "api",
  wire: {
    url: "https://www.zohoapis.com/crm/v2/Contacts/c1",
    header: ["authorization", "Zoho-oauthtoken secret_zoho"],
  },
} satisfies CredentialFixture;
