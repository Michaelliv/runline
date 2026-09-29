import zendesk from "../../../../runline-plugins/zendesk/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: zendesk,
  name: "zendesk",
  config: {
    subdomain: "acme",
    email: "agent@acme.com",
    apiToken: "ztok",
  },
  secrets: ["email", "apiToken"],
  action: "ticket.get",
  input: { id: "1" },
  response: { ticket: { id: 1 } },
  target: "api",
  wire: {
    url: "https://acme.zendesk.com/api/v2/tickets/1.json",
    header: ["authorization", "Basic YWdlbnRAYWNtZS5jb20vdG9rZW46enRvaw=="],
  },
} satisfies CredentialFixture;
