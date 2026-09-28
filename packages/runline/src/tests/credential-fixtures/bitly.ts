import bitly from "../../../../runline-plugins/bitly/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: bitly,
  name: "bitly",
  config: { accessToken: "secret_bitly" },
  secrets: ["accessToken"],
  action: "link.get",
  input: { bitlink: "bit.ly/22u3ypK" },
  response: { id: "bit.ly/22u3ypK" },
  target: "api",
  wire: {
    url: "https://api-ssl.bitly.com/v4/bitlinks/bit.ly/22u3ypK",
    header: ["authorization", "Bearer secret_bitly"],
  },
} satisfies CredentialFixture;
