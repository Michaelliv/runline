import npm from "../../../../runline-plugins/npm/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: npm,
  name: "npm",
  config: { token: "npm_token" },
  secrets: ["token"],
  action: "package.getMetadata",
  input: { packageName: "@scope/pkg", version: "1.0.0" },
  response: { name: "@scope/pkg" },
  target: "registry",
  wire: {
    url: "https://registry.npmjs.org/%40scope%2Fpkg/1.0.0",
    header: ["authorization", "Bearer npm_token"],
  },
} satisfies CredentialFixture;
