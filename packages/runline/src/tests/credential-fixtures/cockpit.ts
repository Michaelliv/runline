import cockpit from "../../../../runline-plugins/cockpit/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: cockpit,
  name: "cockpit",
  config: { url: "https://cockpit.example.com", accessToken: "ck_token" },
  secrets: ["accessToken"],
  action: "singleton.get",
  input: { singleton: "site" },
  response: { title: "Site" },
  target: "api",
  wire: {
    url: "https://cockpit.example.com/api/singletons/get/site?token=ck_token",
  },
} satisfies CredentialFixture;
