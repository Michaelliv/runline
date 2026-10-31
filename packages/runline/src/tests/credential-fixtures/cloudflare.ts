import cloudflare from "../../../../runline-plugins/cloudflare/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: cloudflare,
  name: "cloudflare",
  config: { apiToken: "secret_cloudflare" },
  secrets: ["apiToken"],
  action: "zoneCertificate.list",
  input: { zoneId: "z1" },
  response: { result: [] },
  target: "api",
  wire: {
    url: "https://api.cloudflare.com/client/v4/zones/z1/origin_tls_client_auth",
    header: ["authorization", "Bearer secret_cloudflare"],
  },
} satisfies CredentialFixture;
