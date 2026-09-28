import bambooHr from "../../../../runline-plugins/bambooHr/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: bambooHr,
  name: "bambooHr",
  config: { subdomain: "sub", apiKey: "bamboo_key" },
  secrets: ["apiKey"],
  action: "employee.list",
  input: {},
  response: { employees: [] },
  target: "api",
  wire: {
    url: "https://api.bamboohr.com/api/gateway.php/sub/v1/employees/directory",
    header: ["authorization", "Basic YmFtYm9vX2tleTp4"],
  },
} satisfies CredentialFixture;
