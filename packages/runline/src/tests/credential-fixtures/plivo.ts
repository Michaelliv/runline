import plivo from "../../../../runline-plugins/plivo/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: plivo,
  name: "plivo",
  config: { authId: "MA1", authToken: "pl_token" },
  secrets: ["authId", "authToken"],
  action: "sms.send",
  input: { from: "+15550100", to: "+15550101", message: "hi" },
  response: { message_uuid: ["m1"] },
  target: "api",
  wire: {
    url: "https://api.plivo.com/v1/Account/MA1/Message/",
    header: [
      "authorization",
      `Basic ${Buffer.from("MA1:pl_token").toString("base64")}`,
    ],
  },
} satisfies CredentialFixture;
