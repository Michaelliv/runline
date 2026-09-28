import philipsHue from "../../../../runline-plugins/philipsHue/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: philipsHue,
  name: "philipsHue",
  config: { accessToken: "hue_token", username: "bridgeuser" },
  secrets: ["accessToken"],
  action: "light.get",
  input: { lightId: "1" },
  response: { state: { on: true } },
  target: "api",
  wire: {
    url: "https://api.meethue.com/route/api/bridgeuser/lights/1",
    header: ["authorization", "Bearer hue_token"],
  },
} satisfies CredentialFixture;
