import clockify from "../../../../runline-plugins/clockify/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: clockify,
  name: "clockify",
  config: { apiKey: "clockify_key" },
  secrets: ["apiKey"],
  action: "workspace.list",
  input: {},
  response: [{ id: "w1" }],
  target: "api",
  wire: {
    url: "https://api.clockify.me/api/v1/workspaces",
    header: ["X-Api-Key", "clockify_key"],
  },
} satisfies CredentialFixture;
