import securityScorecard from "../../../../runline-plugins/securityScorecard/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: securityScorecard,
  name: "securityScorecard",
  config: { apiKey: "ssc_key" },
  secrets: ["apiKey"],
  action: "company.getScorecard",
  input: { domain: "example.com" },
  response: { domain: "example.com" },
  target: "api",
  wire: {
    url: "https://api.securityscorecard.io/companies/example.com",
    header: ["authorization", "Token ssc_key"],
  },
} satisfies CredentialFixture;
