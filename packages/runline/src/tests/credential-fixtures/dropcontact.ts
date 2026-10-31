import dropcontact from "../../../../runline-plugins/dropcontact/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: dropcontact,
  name: "dropcontact",
  config: { apiKey: "dc_secret" },
  secrets: ["apiKey"],
  action: "contact.fetchRequest",
  input: { requestId: "r1" },
  response: { success: true, data: [] },
  target: "api",
  wire: {
    url: "https://api.dropcontact.io/batch/r1",
    header: ["x-access-token", "dc_secret"],
  },
} satisfies CredentialFixture;
