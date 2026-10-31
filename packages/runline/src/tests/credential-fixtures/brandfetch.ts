import brandfetch from "../../../../runline-plugins/brandfetch/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: brandfetch,
  name: "brandfetch",
  config: { apiKey: "bf_key" },
  secrets: ["apiKey"],
  action: "brand.getCompany",
  input: { domain: "nike.com" },
  response: { company: { name: "Nike" } },
  target: "api",
  wire: {
    url: "https://api.brandfetch.io/v2/brands/nike.com",
    header: ["authorization", "Bearer bf_key"],
  },
} satisfies CredentialFixture;
