import uplead from "../../../../runline-plugins/uplead/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: uplead,
  name: "uplead",
  config: { apiKey: "up_key" },
  secrets: ["apiKey"],
  action: "company.enrich",
  input: { domain: "example.com" },
  response: { data: { domain: "example.com" } },
  target: "api",
  wire: {
    url: "https://api.uplead.com/v2/company-search?domain=example.com",
    header: ["authorization", "up_key"],
  },
} satisfies CredentialFixture;
