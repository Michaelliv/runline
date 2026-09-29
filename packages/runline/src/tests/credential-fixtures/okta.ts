import okta from "../../../../runline-plugins/okta/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: okta,
  name: "okta",
  config: { url: "https://acme.okta.com", apiToken: "okta_ssws" },
  secrets: ["apiToken"],
  action: "user.get",
  input: { userId: "u1" },
  response: { id: "u1" },
  target: "api",
  wire: {
    url: "https://acme.okta.com/api/v1/users/u1",
    header: ["authorization", "SSWS okta_ssws"],
  },
} satisfies CredentialFixture;
