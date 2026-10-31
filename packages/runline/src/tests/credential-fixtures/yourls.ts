import yourls from "../../../../runline-plugins/yourls/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: yourls,
  name: "yourls",
  config: { url: "https://sho.rt", signature: "yourls_sig" },
  secrets: ["signature"],
  action: "url.expand",
  input: { shortUrl: "abc" },
  response: { status: "success", longurl: "https://example.com/long" },
  target: "api",
  wire: {
    url: "https://sho.rt/yourls-api.php?action=expand&shorturl=abc&format=json&signature=yourls_sig",
  },
} satisfies CredentialFixture;
