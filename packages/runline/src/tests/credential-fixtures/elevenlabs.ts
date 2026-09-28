import elevenlabs from "../../../../runline-plugins/elevenlabs/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: elevenlabs,
  name: "elevenlabs",
  config: { apiKey: "el_key" },
  secrets: ["apiKey"],
  action: "models.list",
  input: {},
  response: [{ model_id: "eleven_multilingual_v2", name: "Multilingual v2" }],
  target: "api",
  wire: {
    url: "https://api.elevenlabs.io/v1/models",
    header: ["xi-api-key", "el_key"],
  },
} satisfies CredentialFixture;
