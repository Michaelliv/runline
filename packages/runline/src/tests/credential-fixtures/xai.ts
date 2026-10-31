import xai from "../../../../runline-plugins/xai/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: xai,
  name: "xai",
  config: { apiKey: "xai_key" },
  secrets: ["apiKey"],
  action: "image.create",
  input: { prompt: "a red bicycle" },
  response: { data: [] },
  target: "api",
  wire: {
    url: "https://api.x.ai/v1/images/generations",
    header: ["authorization", "Bearer xai_key"],
  },
} satisfies CredentialFixture;
