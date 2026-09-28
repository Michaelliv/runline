import highlevel from "../../../../runline-plugins/highlevel/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: highlevel,
  name: "highlevel",
  config: { accessToken: "secret_highlevel", locationId: "loc1" },
  secrets: ["accessToken"],
  action: "contact.get",
  input: { id: "c1" },
  response: { contact: { id: "c1" } },
  target: "api",
  wire: {
    url: "https://services.leadconnectorhq.com/contacts/c1/",
    header: ["authorization", "Bearer secret_highlevel"],
  },
} satisfies CredentialFixture;
