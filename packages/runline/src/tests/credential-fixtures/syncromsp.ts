import syncromsp from "../../../../runline-plugins/syncromsp/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: syncromsp,
  name: "syncromsp",
  config: { subdomain: "sub1", apiKey: "sy_secret" },
  secrets: ["apiKey"],
  action: "customer.get",
  input: { id: "1" },
  response: { customer: { id: 1 } },
  target: "api",
  wire: {
    url: "https://sub1.syncromsp.com/api/v1/customers/1?api_key=sy_secret",
  },
} satisfies CredentialFixture;
