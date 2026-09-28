import medium from "../../../../runline-plugins/medium/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: medium,
  name: "medium",
  config: { accessToken: "secret_medium" },
  secrets: ["accessToken"],
  action: "me",
  input: {},
  response: { data: { id: "u1" } },
  target: "api",
  wire: {
    url: "https://api.medium.com/v1/me",
    header: ["authorization", "Bearer secret_medium"],
  },
} satisfies CredentialFixture;
