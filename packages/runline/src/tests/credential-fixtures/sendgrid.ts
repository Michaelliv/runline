import sendgrid from "../../../../runline-plugins/sendgrid/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: sendgrid,
  name: "sendgrid",
  config: { apiKey: "sg_key" },
  secrets: ["apiKey"],
  action: "list.get",
  input: { listId: "l1" },
  response: { id: "l1" },
  target: "api",
  wire: {
    url: "https://api.sendgrid.com/v3/marketing/lists/l1",
    header: ["authorization", "Bearer sg_key"],
  },
} satisfies CredentialFixture;
