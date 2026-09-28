import hunter from "../../../../runline-plugins/hunter/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: hunter,
  name: "hunter",
  config: { apiKey: "hunter_key" },
  secrets: ["apiKey"],
  action: "emailVerifier",
  input: { email: "a@b.com" },
  response: { data: { status: "valid" } },
  target: "api",
  wire: {
    url: "https://api.hunter.io/v2/email-verifier?email=a%40b.com&api_key=hunter_key",
  },
} satisfies CredentialFixture;
