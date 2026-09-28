import fal from "../../../../runline-plugins/fal/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: fal,
  name: "fal",
  config: { apiKey: "fal_secret" },
  secrets: ["apiKey"],
  action: "queue.status",
  input: { model: "fal-ai/flux/schnell", requestId: "req-1" },
  response: { status: "IN_QUEUE" },
  target: "queue",
  wire: {
    url: "https://queue.fal.run/fal-ai/flux/requests/req-1/status",
    header: ["authorization", "Key fal_secret"],
  },
} satisfies CredentialFixture;
