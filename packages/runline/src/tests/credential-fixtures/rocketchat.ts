import rocketchat from "../../../../runline-plugins/rocketchat/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: rocketchat,
  name: "rocketchat",
  config: {
    domain: "https://chat.example.com",
    userId: "u1",
    authToken: "secret_rocketchat",
  },
  secrets: ["authToken"],
  action: "chat.postMessage",
  input: { channel: "#general", text: "hello" },
  response: { success: true },
  target: "api",
  wire: {
    url: "https://chat.example.com/api/v1/chat.postMessage",
    header: ["x-auth-token", "secret_rocketchat"],
  },
} satisfies CredentialFixture;
