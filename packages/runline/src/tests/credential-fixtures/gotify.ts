import gotify from "../../../../runline-plugins/gotify/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: gotify,
  name: "gotify",
  config: {
    url: "https://gotify.example.com",
    appApiToken: "app_tok",
    clientApiToken: "client_tok",
  },
  secrets: ["appApiToken", "clientApiToken"],
  action: "message.create",
  input: { message: "hi" },
  response: { id: 1 },
  target: "app",
  wire: {
    url: "https://gotify.example.com/message",
    header: ["x-gotify-key", "app_tok"],
  },
} satisfies CredentialFixture;
