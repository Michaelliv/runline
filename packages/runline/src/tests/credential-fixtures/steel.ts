import steel from "../../../../runline-plugins/steel/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: steel,
  name: "steel",
  config: { apiKey: "ste_key" },
  secrets: ["apiKey"],
  action: "session.get",
  input: { id: "s1" },
  response: { id: "s1" },
  target: "api",
  wire: {
    url: "https://api.steel.dev/v1/sessions/s1",
    header: ["steel-api-key", "ste_key"],
  },
} satisfies CredentialFixture;
