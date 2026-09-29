import salesmate from "../../../../runline-plugins/salesmate/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: salesmate,
  name: "salesmate",
  config: { sessionToken: "sm_token", linkname: "acme" },
  secrets: ["sessionToken"],
  action: "company.get",
  input: { id: "5" },
  response: { Data: { id: 5 } },
  target: "api",
  wire: {
    url: "https://apis.salesmate.io/v1/companies/5",
    header: ["sessiontoken", "sm_token"],
  },
} satisfies CredentialFixture;
