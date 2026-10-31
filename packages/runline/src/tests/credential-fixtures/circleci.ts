import circleci from "../../../../runline-plugins/circleci/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: circleci,
  name: "circleci",
  config: { apiKey: "cci_token" },
  secrets: ["apiKey"],
  action: "pipeline.get",
  input: { vcs: "gh", projectSlug: "myrepo", pipelineNumber: 5 },
  response: { id: "p1" },
  target: "api",
  wire: {
    url: "https://circleci.com/api/v2/project/gh/myrepo/pipeline/5",
    header: ["Circle-Token", "cci_token"],
  },
} satisfies CredentialFixture;
