import together from "../../../../runline-plugins/together/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: together,
  name: "together",
  config: { apiKey: "tg_secret" },
  secrets: ["apiKey"],
  action: "image.create",
  input: { prompt: "a fox" },
  response: { data: [] },
  target: "api",
  wire: {
    url: "https://api.together.xyz/v1/images/generations",
    header: ["authorization", "Bearer tg_secret"],
  },
} satisfies CredentialFixture;
