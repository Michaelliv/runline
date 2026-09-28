import posthog from "../../../../runline-plugins/posthog/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: posthog,
  name: "posthog",
  config: { url: "https://app.posthog.com", apiKey: "phc_key" },
  secrets: ["apiKey"],
  action: "event.create",
  input: { events: [{ event: "e", distinct_id: "u1" }] },
  response: { status: 1 },
  target: "api",
  wire: {
    url: "https://app.posthog.com/capture",
    field: ["api_key", "phc_key"],
  },
} satisfies CredentialFixture;
