import sentry from "../../../../runline-plugins/sentry/src/index.js";
import type { CredentialFixture } from "./fixture.js";

export default {
  plugin: sentry,
  name: "sentry",
  config: { token: "sentry_tok" },
  secrets: ["token"],
  action: "issue.get",
  input: { issueId: "42" },
  response: { id: "42" },
  target: "api",
  wire: {
    url: "https://sentry.io/api/0/issues/42/",
    header: ["authorization", "Bearer sentry_tok"],
  },
} satisfies CredentialFixture;
