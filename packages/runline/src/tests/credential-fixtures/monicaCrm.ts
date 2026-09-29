import monicaCrm from "../../../../runline-plugins/monicaCrm/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: monicaCrm,
  name: "monicaCrm",
  config: { apiToken: "monica_token" },
  secrets: ["apiToken"],
  action: "contact.get",
  input: { id: "5" },
  response: { data: { id: 5 } },
  target: "api",
  wire: {
    url: "https://app.monicahq.com/api/contacts/5",
    header: ["authorization", "Bearer monica_token"],
  },
} satisfies CredentialFixture;
