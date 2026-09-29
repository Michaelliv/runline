import erpnext from "../../../../runline-plugins/erpnext/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: erpnext,
  name: "erpnext",
  config: {
    host: "https://erp.example.com",
    apiKey: "erp_key",
    apiSecret: "erp_secret",
  },
  secrets: ["apiKey", "apiSecret"],
  action: "document.get",
  input: { docType: "Customer", documentName: "CUST-1" },
  response: { data: { name: "CUST-1" } },
  target: "api",
  wire: {
    url: "https://erp.example.com/api/resource/Customer/CUST-1",
    header: ["authorization", "token erp_key:erp_secret"],
  },
} satisfies CredentialFixture;
