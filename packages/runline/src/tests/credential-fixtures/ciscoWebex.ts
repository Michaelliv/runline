import ciscoWebex from "../../../../runline-plugins/ciscoWebex/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: ciscoWebex,
  name: "ciscoWebex",
  config: { accessToken: "webex_token" },
  secrets: ["accessToken"],
  action: "message.get",
  input: { messageId: "m1" },
  response: { id: "m1" },
  target: "api",
  wire: {
    url: "https://webexapis.com/v1/messages/m1",
    header: ["authorization", "Bearer webex_token"],
  },
} satisfies CredentialFixture;
