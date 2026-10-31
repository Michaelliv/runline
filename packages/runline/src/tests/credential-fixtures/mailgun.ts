import mailgun from "../../../../runline-plugins/mailgun/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: mailgun,
  name: "mailgun",
  config: {
    apiKey: "mg_secret",
    apiDomain: "api.mailgun.net",
    emailDomain: "mg.example.com",
  },
  secrets: ["apiKey"],
  action: "email.send",
  input: { to: "to@example.com", from: "from@example.com", subject: "Hi" },
  response: { id: "m1", message: "Queued" },
  target: "us",
  wire: {
    url: "https://api.mailgun.net/v3/mg.example.com/messages",
    header: ["authorization", "Basic YXBpOm1nX3NlY3JldA=="],
  },
} satisfies CredentialFixture;
