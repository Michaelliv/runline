import telegram from "../../../../runline-plugins/telegram/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: telegram,
  name: "telegram",
  config: { accessToken: "123:ABC" },
  secrets: ["accessToken"],
  action: "chat.get",
  input: { chatId: "c1" },
  response: { ok: true, result: { id: "c1" } },
  target: "api",
  wire: {
    url: "https://api.telegram.org/bot123:ABC/getChat",
    field: ["chat_id", "c1"],
  },
} satisfies CredentialFixture;
