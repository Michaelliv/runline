import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { registerMetadataActions } from "./metadata.js";
import { registerQueryActions } from "./query.js";
import { registerGenericSObjectActions, registerStandardSObjectActions } from "./sobjects.js";

export default function salesforce(rl: RunlinePluginAPI) {
  rl.setName("salesforce");
  rl.setVersion("0.2.0");
  rl.setConnectionSchema(t.Object({
    instanceUrl: t.Optional(t.String({
      description:
        "Salesforce API instance URL, e.g. https://your-domain.my.salesforce.com. Required for static accessToken auth; optional for client credentials when loginUrl is set.",
      env: "SALESFORCE_INSTANCE_URL",
    })),
    accessToken: t.Optional(t.String({
      description: "Salesforce OAuth2 access token. Use for static-token auth.",
      env: "SALESFORCE_ACCESS_TOKEN",
    })),
    loginUrl: t.Optional(t.String({
      description:
        "Salesforce OAuth token host for client credentials, usually your My Domain URL such as https://your-domain.my.salesforce.com.",
      env: "SALESFORCE_LOGIN_URL",
    })),
    clientId: t.Optional(t.String({
      description:
        "Salesforce Connected App consumer key for OAuth client credentials flow.",
      env: "SALESFORCE_CLIENT_ID",
    })),
    clientSecret: t.Optional(t.String({
      description:
        "Salesforce Connected App consumer secret for OAuth client credentials flow.",
      env: "SALESFORCE_CLIENT_SECRET",
    })),
    apiVersion: t.Optional(t.String({
      description:
        "Salesforce REST API version (default v59.0). Accepts vXX.0 or XX.0.",
      env: "SALESFORCE_API_VERSION",
    })),
  }));

  registerMetadataActions(rl);
  registerQueryActions(rl);
  registerStandardSObjectActions(rl);
  registerGenericSObjectActions(rl);
}
