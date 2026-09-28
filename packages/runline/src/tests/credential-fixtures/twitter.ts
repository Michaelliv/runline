import twitter from "../../../../runline-plugins/twitter/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: twitter,
  name: "twitter",
  config: { bearerToken: "tw_bearer" },
  secrets: ["bearerToken"],
  action: "user.get",
  input: { me: true },
  response: { data: { id: "1", username: "me" } },
  target: "api",
  wire: {
    url: "https://api.twitter.com/2/users/me",
    header: ["authorization", "Bearer tw_bearer"],
  },
} satisfies CredentialFixture;
