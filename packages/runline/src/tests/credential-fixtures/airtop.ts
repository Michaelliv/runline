import airtop from "../../../../runline-plugins/airtop/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: airtop,
  name: "airtop",
  config: { apiKey: "airtop_key" },
  secrets: ["apiKey"],
  action: "file.get",
  input: { fileId: "f1" },
  response: { data: { id: "f1" } },
  target: "api",
  wire: {
    url: "https://api.airtop.ai/api/v1/files/f1",
    header: ["authorization", "Bearer airtop_key"],
  },
} satisfies CredentialFixture;
