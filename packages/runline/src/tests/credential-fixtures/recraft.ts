import recraft from "../../../../runline-plugins/recraft/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: recraft,
  name: "recraft",
  config: { apiKey: "recraft_key" },
  secrets: ["apiKey"],
  action: "image.create",
  input: { prompt: "a cup" },
  // No images in the response, so the action writes nothing to disk.
  response: { data: [] },
  target: "images",
  wire: {
    url: "https://external.api.recraft.ai/v1/images/generations",
    header: ["authorization", "Bearer recraft_key"],
  },
} satisfies CredentialFixture;
