import helpscout from "../../../../runline-plugins/helpscout/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: helpscout,
  name: "helpscout",
  config: { accessToken: "hs_secret" },
  secrets: ["accessToken"],
  action: "mailbox.get",
  input: { mailboxId: 42 },
  response: { id: 42, name: "Support" },
  target: "api",
  wire: {
    url: "https://api.helpscout.net/v2/mailboxes/42",
    header: ["authorization", "Bearer hs_secret"],
  },
} satisfies CredentialFixture;
