import lonescale from "../../../../runline-plugins/lonescale/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: lonescale,
  name: "lonescale",
  config: { apiKey: "ls_secret" },
  secrets: ["apiKey"],
  action: "list.list",
  input: {},
  response: [],
  target: "api",
  wire: {
    url: "https://public-api.lonescale.com/lists",
    header: ["x-api-key", "ls_secret"],
  },
} satisfies CredentialFixture;
