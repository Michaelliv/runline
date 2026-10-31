import salesforce from "../../../../runline-plugins/salesforce/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: salesforce,
  name: "salesforce",
  config: {
    instanceUrl: "https://example.my.salesforce.com",
    accessToken: "sf_token",
  },
  secrets: ["accessToken"],
  action: "limits.get",
  input: {},
  response: {},
  target: "api",
  wire: {
    url: "https://example.my.salesforce.com/services/data/v59.0/limits",
    header: ["authorization", "Bearer sf_token"],
  },
} satisfies CredentialFixture;
