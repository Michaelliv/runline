import pagerduty from "../../../../runline-plugins/pagerduty/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: pagerduty,
  name: "pagerduty",
  config: { apiToken: "pd_tok" },
  secrets: ["apiToken"],
  action: "user.get",
  input: { userId: "u1" },
  response: { user: { id: "u1" } },
  target: "api",
  wire: {
    url: "https://api.pagerduty.com/users/u1",
    header: ["authorization", "Token token=pd_tok"],
  },
} satisfies CredentialFixture;
