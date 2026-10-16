import agentMail from "../../../../runline-plugins/agentMail/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: agentMail,
  name: "agentMail",
  config: { apiKey: "secret_agentmail" },
  secrets: ["apiKey"],
  action: "whoami",
  input: {},
  response: { organization_id: "org1" },
  target: "api",
  wire: {
    url: "https://api.agentmail.to/v0/auth/me",
    header: ["authorization", "Bearer secret_agentmail"],
  },
} satisfies CredentialFixture;
