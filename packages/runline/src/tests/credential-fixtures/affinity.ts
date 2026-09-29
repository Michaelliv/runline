import affinity from "../../../../runline-plugins/affinity/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: affinity,
  name: "affinity",
  config: { apiKey: "affinity_key" },
  secrets: ["apiKey"],
  action: "list.get",
  input: { listId: "l1" },
  response: { id: "l1" },
  target: "api",
  wire: {
    url: "https://api.affinity.co/lists/l1",
    header: ["authorization", "Basic OmFmZmluaXR5X2tleQ=="],
  },
} satisfies CredentialFixture;
