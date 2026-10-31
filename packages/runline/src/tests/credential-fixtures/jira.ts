import jira from "../../../../runline-plugins/jira/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: jira,
  name: "jira",
  config: {
    domain: "https://mycompany.atlassian.net",
    email: "me@example.com",
    apiToken: "jira_tok",
  },
  secrets: ["email", "apiToken"],
  action: "issue.get",
  input: { issueKey: "PROJ-1" },
  response: { key: "PROJ-1" },
  target: "api",
  wire: {
    url: "https://mycompany.atlassian.net/rest/api/2/issue/PROJ-1",
    header: ["authorization", "Basic bWVAZXhhbXBsZS5jb206amlyYV90b2s="],
  },
} satisfies CredentialFixture;
