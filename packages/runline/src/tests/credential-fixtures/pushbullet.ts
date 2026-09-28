import pushbullet from "../../../../runline-plugins/pushbullet/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: pushbullet,
  name: "pushbullet",
  config: { accessToken: "pb_token" },
  secrets: ["accessToken"],
  action: "push.list",
  input: { limit: 5 },
  response: { pushes: [] },
  target: "api",
  wire: {
    url: "https://api.pushbullet.com/v2/pushes?limit=5",
    header: ["access-token", "pb_token"],
  },
} satisfies CredentialFixture;
