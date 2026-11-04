import fxmacrodata from "../../../../runline-plugins/fxmacrodata/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: fxmacrodata,
  name: "fxmacrodata",
  config: { apiKey: "fxmd_key" },
  secrets: ["apiKey"],
  action: "forex.list",
  input: { base: "EUR", quote: "USD" },
  response: { base: "EUR", quote: "USD", data: [] },
  target: "api",
  wire: {
    url: "https://api.fxmacrodata.com/v1/forex/eur/usd?limit=20&offset=0",
    header: ["X-API-Key", "fxmd_key"],
  },
} satisfies CredentialFixture;
