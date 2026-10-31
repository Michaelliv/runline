import pushover from "../../../../runline-plugins/pushover/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: pushover,
  name: "pushover",
  config: { apiToken: "po_token" },
  secrets: ["apiToken"],
  action: "message.push",
  input: { userKey: "u1", message: "hi" },
  response: { status: 1 },
  target: "api",
  wire: {
    url: "https://api.pushover.net/1/messages.json",
    field: ["token", "po_token"],
  },
} satisfies CredentialFixture;
