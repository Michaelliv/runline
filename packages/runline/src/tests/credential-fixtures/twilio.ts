import twilio from "../../../../runline-plugins/twilio/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: twilio,
  name: "twilio",
  config: { accountSid: "AC1", authToken: "tw_token" },
  secrets: ["accountSid", "authToken"],
  action: "sms.send",
  input: { from: "+15550100", to: "+15550101", body: "hi" },
  response: { sid: "SM1" },
  target: "api",
  wire: {
    url: "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json",
    header: [
      "authorization",
      `Basic ${Buffer.from("AC1:tw_token").toString("base64")}`,
    ],
  },
} satisfies CredentialFixture;
