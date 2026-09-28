import shiftObjects from "../../../../runline-plugins/shiftObjects/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: shiftObjects,
  name: "shiftObjects",
  config: { apiKey: "shift_key" },
  secrets: ["apiKey"],
  action: "object.get",
  input: { id: "o1" },
  response: { id: "o1" },
  target: "api",
  wire: {
    url: "https://cloud.shift-labs.ai/v1/services/objects/objects/o1",
    header: ["authorization", "Bearer shift_key"],
  },
} satisfies CredentialFixture;
