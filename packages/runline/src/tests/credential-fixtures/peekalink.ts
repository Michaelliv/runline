import peekalink from "../../../../runline-plugins/peekalink/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: peekalink,
  name: "peekalink",
  config: { apiKey: "pk_secret" },
  secrets: ["apiKey"],
  action: "link.isAvailable",
  input: { url: "https://example.com" },
  response: { isAvailable: true },
  target: "api",
  wire: {
    url: "https://api.peekalink.io/is-available/",
    header: ["x-api-key", "pk_secret"],
  },
} satisfies CredentialFixture;
