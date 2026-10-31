import servicenow from "../../../../runline-plugins/servicenow/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: servicenow,
  name: "servicenow",
  config: {
    subdomain: "dev",
    username: "admin",
    password: "secret_servicenow",
  },
  secrets: ["username", "password"],
  action: "incident.get",
  input: { sysId: "abc" },
  response: { result: { sys_id: "abc" } },
  target: "api",
  wire: {
    url: "https://dev.service-now.com/api/now/table/incident/abc",
    header: ["authorization", "Basic YWRtaW46c2VjcmV0X3NlcnZpY2Vub3c="],
  },
} satisfies CredentialFixture;
