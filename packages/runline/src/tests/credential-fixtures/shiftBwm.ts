import shiftBwm from "../../../../runline-plugins/shiftBwm/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: shiftBwm,
  name: "shiftBwm",
  config: { apiKey: "shift_key" },
  secrets: ["apiKey"],
  action: "objectType.list",
  input: {},
  response: { objectTypes: [] },
  target: "api",
  wire: {
    url: "https://cloud.shift-labs.ai/v1/services/business-world-model/object-types",
    header: ["authorization", "Bearer shift_key"],
  },
} satisfies CredentialFixture;
