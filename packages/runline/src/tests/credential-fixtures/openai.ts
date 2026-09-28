import openai from "../../../../runline-plugins/openai/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: openai,
  name: "openai",
  config: { apiKey: "sk_openai" },
  secrets: ["apiKey"],
  action: "image.create",
  input: { prompt: "a red bicycle on snow" },
  response: { data: [] },
  target: "api",
  wire: {
    url: "https://api.openai.com/v1/images/generations",
    header: ["authorization", "Bearer sk_openai"],
  },
} satisfies CredentialFixture;
