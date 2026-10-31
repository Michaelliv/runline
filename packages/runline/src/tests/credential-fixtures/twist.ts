import twist from "../../../../runline-plugins/twist/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: twist,
  name: "twist",
  config: { accessToken: "twist_token" },
  secrets: ["accessToken"],
  action: "channel.get",
  input: { id: 7 },
  response: { id: 7 },
  target: "api",
  wire: {
    url: "https://api.twist.com/api/v3/channels/getone?id=7",
    header: ["authorization", "Bearer twist_token"],
  },
} satisfies CredentialFixture;
