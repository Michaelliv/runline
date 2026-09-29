import apiTemplateIo from "../../../../runline-plugins/apiTemplateIo/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: apiTemplateIo,
  name: "apiTemplateIo",
  config: { apiKey: "at_key" },
  secrets: ["apiKey"],
  action: "account.get",
  input: {},
  response: { status: "success" },
  target: "api",
  wire: {
    url: "https://api.apitemplate.io/v1/account-information",
    header: ["x-api-key", "at_key"],
  },
} satisfies CredentialFixture;
