import matrix from "../../../../runline-plugins/matrix/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: matrix,
  name: "matrix",
  config: {
    homeserverUrl: "https://matrix.org",
    accessToken: "secret_matrix",
  },
  secrets: ["accessToken"],
  action: "account.me",
  input: {},
  response: { user_id: "@alice:matrix.org" },
  target: "api",
  wire: {
    url: "https://matrix.org/_matrix/client/r0/account/whoami",
    header: ["authorization", "Bearer secret_matrix"],
  },
} satisfies CredentialFixture;
