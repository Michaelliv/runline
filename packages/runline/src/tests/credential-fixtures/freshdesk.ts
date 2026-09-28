import freshdesk from "../../../../runline-plugins/freshdesk/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: freshdesk,
  name: "freshdesk",
  config: { domain: "acme", apiKey: "fd_key" },
  secrets: ["apiKey"],
  action: "ticket.get",
  input: { ticketId: "42" },
  response: { id: 42 },
  target: "api",
  wire: {
    url: "https://acme.freshdesk.com/api/v2/tickets/42",
    header: ["authorization", "Basic ZmRfa2V5Olg="],
  },
} satisfies CredentialFixture;
