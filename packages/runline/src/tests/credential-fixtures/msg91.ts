import msg91 from "../../../../runline-plugins/msg91/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: msg91,
  name: "msg91",
  config: { authkey: "msg91_key" },
  secrets: ["authkey"],
  action: "sms.send",
  input: { from: "RL", to: "15550001111", message: "hi" },
  response: "req-1",
  target: "api",
  wire: {
    url: "https://api.msg91.com/api/sendhttp.php?route=4&country=0&sender=RL&mobiles=15550001111&message=hi&authkey=msg91_key",
  },
} satisfies CredentialFixture;
