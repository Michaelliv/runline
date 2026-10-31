import uproc from "../../../../runline-plugins/uproc/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: uproc,
  name: "uproc",
  config: { email: "me@example.com", apiKey: "up_secret" },
  secrets: ["email", "apiKey"],
  action: "process.run",
  input: { processor: "get-email-from-name-and-domain", params: { name: "a" } },
  response: { result: {} },
  target: "api",
  wire: {
    url: "https://api.uproc.io/api/v2/process",
    header: [
      "authorization",
      `Basic ${Buffer.from("me@example.com:up_secret").toString("base64")}`,
    ],
  },
} satisfies CredentialFixture;
