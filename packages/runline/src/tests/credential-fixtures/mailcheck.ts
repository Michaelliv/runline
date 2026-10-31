import mailcheck from "../../../../runline-plugins/mailcheck/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: mailcheck,
  name: "mailcheck",
  config: { apiKey: "secret_mailcheck" },
  secrets: ["apiKey"],
  action: "email.check",
  input: { email: "a@b.co" },
  response: { email: "a@b.co", result: "deliverable" },
  target: "api",
  wire: {
    url: "https://api.mailcheck.co/v1/singleEmail:check",
    header: ["authorization", "Bearer secret_mailcheck"],
  },
} satisfies CredentialFixture;
