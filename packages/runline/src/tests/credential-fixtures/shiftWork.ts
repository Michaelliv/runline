import shiftWork from "../../../../runline-plugins/shiftWork/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: shiftWork,
  name: "shiftWork",
  config: { apiKey: "shift_key" },
  secrets: ["apiKey"],
  action: "issue.get",
  input: { id: "i1" },
  response: { issue: {} },
  target: "api",
  wire: {
    url: "https://cloud.shift-labs.ai/v1/issues/i1",
    header: ["authorization", "Bearer shift_key"],
  },
} satisfies CredentialFixture;
