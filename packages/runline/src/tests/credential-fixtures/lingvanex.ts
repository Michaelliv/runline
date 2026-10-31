import lingvanex from "../../../../runline-plugins/lingvanex/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: lingvanex,
  name: "lingvanex",
  config: { apiKey: "lingvanex_key" },
  secrets: ["apiKey"],
  action: "translate",
  input: { text: "hello", to: "fr_FR" },
  response: { result: "bonjour" },
  target: "api",
  wire: {
    url: "https://api-b2b.backenster.com/b1/api/v3/translate",
    header: ["authorization", "Bearer lingvanex_key"],
  },
} satisfies CredentialFixture;
