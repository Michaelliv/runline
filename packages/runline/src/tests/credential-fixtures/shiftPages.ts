import shiftPages from "../../../../runline-plugins/shiftPages/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: shiftPages,
  name: "shiftPages",
  config: { apiKey: "shift_key" },
  secrets: ["apiKey"],
  action: "page.list",
  input: {},
  response: { pages: [] },
  target: "api",
  wire: {
    url: "https://cloud.shift-labs.ai/v1/pages",
    header: ["authorization", "Bearer shift_key"],
  },
} satisfies CredentialFixture;
