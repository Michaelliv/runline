import pushcut from "../../../../runline-plugins/pushcut/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: pushcut,
  name: "pushcut",
  config: { apiKey: "secret_pushcut" },
  secrets: ["apiKey"],
  action: "notification.send",
  input: { notificationName: "Alert" },
  response: { id: "n1" },
  target: "api",
  wire: {
    url: "https://api.pushcut.io/v1/notifications/Alert",
    header: ["api-key", "secret_pushcut"],
  },
} satisfies CredentialFixture;
