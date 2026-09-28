import profitwell from "../../../../runline-plugins/profitwell/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: profitwell,
  name: "profitwell",
  config: { accessToken: "secret_profitwell" },
  secrets: ["accessToken"],
  action: "company.getSettings",
  input: {},
  response: { name: "Acme" },
  target: "api",
  wire: {
    url: "https://api.profitwell.com/v2/company/settings/",
    header: ["authorization", "secret_profitwell"],
  },
} satisfies CredentialFixture;
