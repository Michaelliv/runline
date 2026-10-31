import messagebird from "../../../../runline-plugins/messagebird/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: messagebird,
  name: "messagebird",
  config: { accessKey: "mb_secret" },
  secrets: ["accessKey"],
  action: "balance.get",
  input: {},
  response: { amount: 10, type: "euros" },
  target: "api",
  wire: {
    url: "https://rest.messagebird.com/balance",
    header: ["authorization", "AccessKey mb_secret"],
  },
} satisfies CredentialFixture;
