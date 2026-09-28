import shiftCrm from "../../../../runline-plugins/shiftCrm/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: shiftCrm,
  name: "shiftCrm",
  config: { apiKey: "shift_crm_key" },
  secrets: ["apiKey"],
  action: "access.me",
  input: {},
  response: { role: "admin" },
  target: "api",
  wire: {
    url: "https://cloud.shift-labs.ai/v1/crm/access/me",
    header: ["authorization", "Bearer shift_crm_key"],
  },
} satisfies CredentialFixture;
