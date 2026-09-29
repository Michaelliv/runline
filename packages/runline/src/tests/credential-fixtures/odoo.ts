import odoo from "../../../../runline-plugins/odoo/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: odoo,
  name: "odoo",
  config: {
    url: "https://acme.odoo.com",
    username: "me@acme.com",
    password: "odoo_pw",
  },
  secrets: ["password"],
  action: "model.getFields",
  input: { model: "contact" },
  response: { result: 7 },
  target: "rpc",
  wire: { url: "https://acme.odoo.com/jsonrpc" },
} satisfies CredentialFixture;
