import travisci from "../../../../runline-plugins/travisci/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: travisci,
  name: "travisci",
  config: { apiToken: "tr_token" },
  secrets: ["apiToken"],
  action: "build.trigger",
  input: { slug: "owner/repo", branch: "main" },
  response: { request: { id: 1 } },
  target: "api",
  wire: {
    url: "https://api.travis-ci.com/repo/owner%2Frepo/requests",
    header: ["authorization", "token tr_token"],
  },
} satisfies CredentialFixture;
