import reddit from "../../../../runline-plugins/reddit/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: reddit,
  name: "reddit",
  config: { accessToken: "rd_token" },
  secrets: ["accessToken"],
  action: "user.get",
  input: { username: "spez" },
  response: { data: { name: "spez" } },
  target: "api",
  wire: {
    url: "https://oauth.reddit.com/user/spez/about.json?api_type=json",
    header: ["authorization", "Bearer rd_token"],
  },
} satisfies CredentialFixture;
