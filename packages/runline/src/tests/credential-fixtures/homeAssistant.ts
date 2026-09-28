import homeAssistant from "../../../../runline-plugins/homeAssistant/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: homeAssistant,
  name: "homeAssistant",
  config: {
    host: "ha.example.com",
    port: 8123,
    ssl: true,
    accessToken: "hass_token",
  },
  secrets: ["accessToken"],
  action: "config.get",
  input: {},
  response: { version: "2024.1.0" },
  target: "api",
  wire: {
    url: "https://ha.example.com:8123/api/config",
    header: ["authorization", "Bearer hass_token"],
  },
} satisfies CredentialFixture;
