import shiftWorkers from "../../../../runline-plugins/shiftWorkers/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: shiftWorkers,
  name: "shiftWorkers",
  config: { apiKey: "shift_key" },
  secrets: ["apiKey"],
  action: "app.get",
  input: { app: "guestbook" },
  response: { name: "guestbook" },
  target: "api",
  wire: {
    url: "https://cloud.shift-labs.ai/v1/services/workers/apps/guestbook",
    header: ["authorization", "Bearer shift_key"],
  },
} satisfies CredentialFixture;
