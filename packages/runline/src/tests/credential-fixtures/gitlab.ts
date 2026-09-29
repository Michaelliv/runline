import gitlab from "../../../../runline-plugins/gitlab/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: gitlab,
  name: "gitlab",
  config: { token: "glpat_token" },
  secrets: ["token"],
  action: "repository.get",
  input: { owner: "group/sub", repo: "proj" },
  response: { id: 1 },
  target: "api",
  wire: {
    url: "https://gitlab.com/api/v4/projects/group%2Fsub%2Fproj",
    header: ["private-token", "glpat_token"],
  },
} satisfies CredentialFixture;
