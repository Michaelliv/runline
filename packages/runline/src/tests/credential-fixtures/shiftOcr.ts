import shiftOcr from "../../../../runline-plugins/shiftOcr/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: shiftOcr,
  name: "shiftOcr",
  config: { apiKey: "shift_key" },
  secrets: ["apiKey"],
  action: "ocr.providers",
  input: {},
  response: { providers: [] },
  target: "api",
  wire: {
    url: "https://cloud.shift-labs.ai/v1/services/ocr/providers",
    header: ["authorization", "Bearer shift_key"],
  },
} satisfies CredentialFixture;
