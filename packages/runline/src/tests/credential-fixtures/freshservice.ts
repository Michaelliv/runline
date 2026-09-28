import freshservice from "../../../../runline-plugins/freshservice/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: freshservice,
  name: "freshservice",
  config: { domain: "sub", apiKey: "fs_key" },
  secrets: ["apiKey"],
  action: "ticket.get",
  input: { id: 5 },
  response: { ticket: { id: 5 } },
  target: "api",
  wire: {
    url: "https://sub.freshservice.com/api/v2/tickets/5",
    header: ["authorization", "Basic ZnNfa2V5Olg="],
  },
} satisfies CredentialFixture;
