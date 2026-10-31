import mailjet from "../../../../runline-plugins/mailjet/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: mailjet,
  name: "mailjet",
  config: {
    apiKeyPublic: "mj_pub",
    apiKeyPrivate: "mj_priv",
    smsToken: "mj_sms",
  },
  secrets: ["apiKeyPublic", "apiKeyPrivate", "smsToken"],
  action: "email.send",
  input: { fromEmail: "a@example.com", toEmail: "b@example.com", subject: "s" },
  response: { Messages: [{ Status: "success" }] },
  target: "email",
  wire: {
    url: "https://api.mailjet.com/v3.1/send",
    header: [
      "authorization",
      `Basic ${Buffer.from("mj_pub:mj_priv").toString("base64")}`,
    ],
  },
} satisfies CredentialFixture;
