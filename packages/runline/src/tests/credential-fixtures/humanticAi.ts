import humanticAi from "../../../../runline-plugins/humanticAi/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: humanticAi,
  name: "humanticAi",
  config: { apiKey: "humantic_key" },
  secrets: ["apiKey"],
  action: "profile.get",
  input: { userId: "u1" },
  response: { results: { userid: "u1" } },
  target: "api",
  wire: {
    url: "https://api.humantic.ai/v1/user-profile?userid=u1&apikey=humantic_key",
  },
} satisfies CredentialFixture;
