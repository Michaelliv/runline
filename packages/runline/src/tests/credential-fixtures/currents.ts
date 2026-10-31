import currents from "../../../../runline-plugins/currents/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: currents,
  name: "currents",
  config: { apiKey: "currents_key" },
  secrets: ["apiKey"],
  action: "action.get",
  input: { actionId: "a1" },
  response: { data: { id: "a1" } },
  target: "api",
  wire: {
    url: "https://api.currents.dev/v1/actions/a1",
    header: ["authorization", "Bearer currents_key"],
  },
} satisfies CredentialFixture;
