import { generateKeyPairSync } from "node:crypto";
import googleAnalytics from "../../../../codemode-plugins/googleAnalytics/src/index.js";
import type { CredentialFixture } from "./fixture.js";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

export default {
  plugin: googleAnalytics,
  name: "googleAnalytics",
  // A service account added to the Analytics property as a user: the
  // method that signs for the Analytics scopes by itself.
  config: {
    authMethod: "serviceAccount",
    serviceAccountEmail: "analytics@project.iam.gserviceaccount.com",
    serviceAccountPrivateKey: privateKey,
    // A fresh token in the flat CLI fields, so the local run signs
    // without a token request first.
    accessToken: "analytics_access",
    accessTokenExpiresAt: 4102444800000,
  },
  secrets: ["serviceAccountPrivateKey", "accessToken"],
  action: "accountSummary.list",
  input: {},
  response: { accountSummaries: [] },
  target: "analyticsAdmin",
  wire: {
    url: "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
    header: ["authorization", "Bearer analytics_access"],
  },
} satisfies CredentialFixture;
