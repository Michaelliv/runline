import xero from "../../../../runline-plugins/xero/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: xero,
  name: "xero",
  config: { accessToken: "secret_xero", tenantId: "t1" },
  secrets: ["accessToken"],
  action: "invoice.get",
  input: { invoiceId: "i1" },
  response: { Invoices: [{ InvoiceID: "i1" }] },
  target: "api",
  wire: {
    url: "https://api.xero.com/api.xro/2.0/Invoices/i1",
    header: ["authorization", "Bearer secret_xero"],
  },
} satisfies CredentialFixture;
