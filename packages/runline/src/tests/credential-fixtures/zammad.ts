import zammad from "../../../../runline-plugins/zammad/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: zammad,
  name: "zammad",
  config: { url: "https://zammad.example.com", token: "zm_secret" },
  secrets: ["token"],
  action: "user.getSelf",
  input: {},
  response: { id: 1, email: "me@example.com" },
  target: "api",
  wire: {
    url: "https://zammad.example.com/api/v1/users/me",
    header: ["authorization", "Token token=zm_secret"],
  },
} satisfies CredentialFixture;
