import iterable from "../../../../runline-plugins/iterable/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: iterable,
  name: "iterable",
  config: { apiKey: "it_key" },
  secrets: ["apiKey"],
  action: "user.get",
  input: { by: "userId", value: "u1" },
  response: { user: { userId: "u1" } },
  target: "api",
  wire: {
    url: "https://api.iterable.com/api/users/byUserId/u1",
    header: ["api-key", "it_key"],
  },
} satisfies CredentialFixture;
