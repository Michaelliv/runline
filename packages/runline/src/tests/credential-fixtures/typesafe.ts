import typesafe from "../../../../runline-plugins/typesafe/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: typesafe,
  name: "typesafe",
  config: { apiKey: "ts_secret" },
  secrets: ["apiKey"],
  action: "model.list",
  input: {},
  response: { models: [] },
  target: "api",
  wire: {
    url: "https://api.typesafe.ai/v1/models",
    header: ["authorization", "Bearer ts_secret"],
  },
} satisfies CredentialFixture;
