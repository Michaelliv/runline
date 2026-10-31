import coingecko from "../../../../runline-plugins/coingecko/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: coingecko,
  name: "coingecko",
  config: { apiKey: "cg_key" },
  secrets: ["apiKey"],
  action: "coin.list",
  input: {},
  response: [{ id: "bitcoin" }],
  target: "api",
  wire: {
    url: "https://api.coingecko.com/api/v3/coins/list",
    header: ["x-cg-demo-api-key", "cg_key"],
  },
} satisfies CredentialFixture;
