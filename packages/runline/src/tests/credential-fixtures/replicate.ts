import replicate from "../../../../runline-plugins/replicate/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: replicate,
  name: "replicate",
  config: { apiToken: "rp_secret" },
  secrets: ["apiToken"],
  action: "image.create",
  input: { prompt: "a fox" },
  response: {
    status: "succeeded",
    urls: { get: "https://api.replicate.com/v1/predictions/p1" },
    output: [],
  },
  target: "api",
  wire: {
    url: "https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions",
    header: ["authorization", "Bearer rp_secret"],
  },
} satisfies CredentialFixture;
