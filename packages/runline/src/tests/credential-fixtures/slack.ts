import slack from "../../../../runline-plugins/slack/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: slack,
  name: "slack",
  config: { accessToken: "secret_slack" },
  secrets: ["accessToken"],
  action: "user.info",
  input: { user: "U1" },
  response: { ok: true, user: { id: "U1" } },
  target: "api",
  wire: {
    url: "https://slack.com/api/users.info?user=U1",
    header: ["authorization", "Bearer secret_slack"],
  },
} satisfies CredentialFixture;
