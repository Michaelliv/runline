import zulip from "../../../../runline-plugins/zulip/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: zulip,
  name: "zulip",
  config: {
    url: "https://zulip.example.com",
    email: "bot@example.com",
    apiKey: "zulip_key",
  },
  secrets: ["email", "apiKey"],
  action: "message.get",
  input: { messageId: "1" },
  response: { result: "success", message: { id: 1 } },
  target: "api",
  wire: {
    url: "https://zulip.example.com/api/v1/messages/1",
    header: ["authorization", "Basic Ym90QGV4YW1wbGUuY29tOnp1bGlwX2tleQ=="],
  },
} satisfies CredentialFixture;
