import autopilot from "../../../../runline-plugins/autopilot/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: autopilot,
  name: "autopilot",
  config: { apiKey: "ap_key" },
  secrets: ["apiKey"],
  action: "contact.get",
  input: { contactId: "person_9EAF39E4" },
  response: { contact_id: "person_9EAF39E4" },
  target: "api",
  wire: {
    url: "https://api2.autopilothq.com/v1/contact/person_9EAF39E4",
    header: ["autopilotapikey", "ap_key"],
  },
} satisfies CredentialFixture;
