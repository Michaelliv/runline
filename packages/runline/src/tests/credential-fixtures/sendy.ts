import sendy from "../../../../runline-plugins/sendy/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: sendy,
  name: "sendy",
  config: { url: "https://mail.example.com", apiKey: "sendy_key" },
  secrets: ["apiKey"],
  action: "subscriber.count",
  input: { listId: "l1" },
  response: 5,
  target: "api",
  wire: {
    url: "https://mail.example.com/api/subscribers/active-subscriber-count.php",
    field: ["api_key", "sendy_key"],
  },
} satisfies CredentialFixture;
