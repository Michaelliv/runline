import openweathermap from "../../../../runline-plugins/openweathermap/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: openweathermap,
  name: "openweathermap",
  config: { apiKey: "owm_key" },
  secrets: ["apiKey"],
  action: "weather.current",
  input: { cityName: "berlin,de" },
  response: { name: "Berlin" },
  target: "api",
  wire: {
    url: "https://api.openweathermap.org/data/2.5/weather?units=metric&q=berlin%2Cde&APPID=owm_key",
  },
} satisfies CredentialFixture;
