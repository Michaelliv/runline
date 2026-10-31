import shiftAtlas from "../../../../runline-plugins/shiftAtlas/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: shiftAtlas,
  name: "shiftAtlas",
  config: { apiKey: "shift_key" },
  secrets: ["apiKey"],
  action: "actor.list",
  input: {},
  response: { actors: [] },
  target: "api",
  wire: {
    url: "https://cloud.shift-labs.ai/v1/services/operational-graph/actors",
    header: ["authorization", "Bearer shift_key"],
  },
} satisfies CredentialFixture;
