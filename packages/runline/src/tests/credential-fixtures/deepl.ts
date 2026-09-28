import deepl from "../../../../runline-plugins/deepl/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: deepl,
  name: "deepl",
  config: { apiKey: "dl_secret:fx", plan: "free" },
  secrets: ["apiKey"],
  action: "language.list",
  input: {},
  response: [{ language: "DE" }],
  target: "api",
  wire: {
    url: "https://api-free.deepl.com/v2/languages?type=target",
    header: ["authorization", "DeepL-Auth-Key dl_secret:fx"],
  },
} satisfies CredentialFixture;
