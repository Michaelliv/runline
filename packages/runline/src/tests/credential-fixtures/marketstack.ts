import marketstack from "../../../../runline-plugins/marketstack/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: marketstack,
  name: "marketstack",
  config: { apiKey: "ms_key", useHttps: true },
  secrets: ["apiKey"],
  action: "ticker.get",
  input: { symbol: "AAPL" },
  response: { symbol: "AAPL" },
  target: "api",
  wire: {
    url: "https://api.marketstack.com/v1/tickers/AAPL?access_key=ms_key",
  },
} satisfies CredentialFixture;
