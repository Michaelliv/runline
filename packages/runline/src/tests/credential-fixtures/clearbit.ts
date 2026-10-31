import clearbit from "../../../../runline-plugins/clearbit/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: clearbit,
  name: "clearbit",
  config: { apiKey: "cb_secret" },
  secrets: ["apiKey"],
  action: "company.autocomplete",
  input: { name: "acme" },
  response: [{ domain: "acme.com" }],
  target: "autocomplete",
  wire: {
    url: "https://autocomplete.clearbit.com/v1/companies/suggest?query=acme",
    header: ["authorization", "Bearer cb_secret"],
  },
} satisfies CredentialFixture;
