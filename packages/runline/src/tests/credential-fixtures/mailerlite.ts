import mailerlite from "../../../../runline-plugins/mailerlite/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: mailerlite,
  name: "mailerlite",
  config: { apiKey: "ml_key" },
  secrets: ["apiKey"],
  action: "subscriber.get",
  input: { subscriberId: "s1" },
  response: { data: { id: "s1" } },
  target: "api",
  wire: {
    url: "https://connect.mailerlite.com/api/subscribers/s1",
    header: ["authorization", "Bearer ml_key"],
  },
} satisfies CredentialFixture;
