import mandrill from "../../../../runline-plugins/mandrill/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: mandrill,
  name: "mandrill",
  config: { apiKey: "md_key" },
  secrets: ["apiKey"],
  action: "message.sendHtml",
  input: { fromEmail: "a@example.com", toEmail: "b@example.com", text: "hi" },
  response: [{ status: "sent" }],
  target: "api",
  wire: {
    url: "https://mandrillapp.com/api/1.0/messages/send.json",
    field: ["key", "md_key"],
  },
} satisfies CredentialFixture;
