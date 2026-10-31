import onfleet from "../../../../runline-plugins/onfleet/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: onfleet,
  name: "onfleet",
  config: { apiKey: "of_key" },
  secrets: ["apiKey"],
  action: "organization.get",
  input: {},
  response: { id: "org1" },
  target: "api",
  wire: {
    url: "https://onfleet.com/api/v2/organization",
    header: ["authorization", `Basic ${btoa("of_key:")}`],
  },
} satisfies CredentialFixture;
