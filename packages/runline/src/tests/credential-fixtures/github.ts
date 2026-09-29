import github from "../../../../runline-plugins/github/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: github,
  name: "github",
  config: { token: "secret_github" },
  secrets: ["token"],
  action: "repository.get",
  input: { owner: "acme", repo: "api" },
  response: { id: 1, full_name: "acme/api" },
  target: "api",
  wire: {
    url: "https://api.github.com/repos/acme/api",
    header: ["authorization", "Bearer secret_github"],
  },
} satisfies CredentialFixture;
