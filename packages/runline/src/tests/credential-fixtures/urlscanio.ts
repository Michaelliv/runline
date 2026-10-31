import urlscanio from "../../../../runline-plugins/urlscanio/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: urlscanio,
  name: "urlscanio",
  config: { apiKey: "us_secret" },
  secrets: ["apiKey"],
  action: "scan.get",
  input: { scanId: "s1" },
  response: { task: { uuid: "s1" } },
  target: "api",
  wire: {
    url: "https://urlscan.io/api/v1/result/s1",
    header: ["api-key", "us_secret"],
  },
} satisfies CredentialFixture;
