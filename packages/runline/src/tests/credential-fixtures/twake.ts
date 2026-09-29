import twake from "../../../../runline-plugins/twake/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: twake,
  name: "twake",
  config: { apiKey: "twake_key" },
  secrets: ["apiKey"],
  action: "message.send",
  input: { channelId: "ch1", content: "hello" },
  response: { object: { id: "m1" } },
  target: "api",
  wire: {
    url: "https://plugins.twake.app/plugins/runline/actions/message/save",
    header: ["authorization", "Bearer twake_key"],
  },
} satisfies CredentialFixture;
