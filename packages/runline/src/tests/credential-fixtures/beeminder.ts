import beeminder from "../../../../runline-plugins/beeminder/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: beeminder,
  name: "beeminder",
  config: { apiToken: "secret_beeminder" },
  secrets: ["apiToken"],
  action: "user.get",
  input: {},
  response: { username: "alice" },
  target: "api",
  wire: {
    url: "https://www.beeminder.com/api/v1/users/me.json?auth_token=secret_beeminder",
  },
} satisfies CredentialFixture;
