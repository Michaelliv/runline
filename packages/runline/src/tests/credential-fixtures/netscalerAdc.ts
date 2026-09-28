import netscalerAdc from "../../../../runline-plugins/netscalerAdc/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: netscalerAdc,
  name: "netscalerAdc",
  config: {
    url: "https://adc.example.com",
    username: "nsroot",
    password: "ns_secret",
  },
  secrets: ["password"],
  action: "file.delete",
  input: { fileName: "old.crt" },
  response: {},
  target: "api",
  wire: {
    url: "https://adc.example.com/nitro/v1/config/systemfile?args=filename:old.crt,filelocation:%2Fnsconfig%2Fssl%2F",
    header: ["x-nitro-pass", "ns_secret"],
  },
} satisfies CredentialFixture;
