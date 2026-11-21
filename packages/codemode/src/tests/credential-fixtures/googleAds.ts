import { generateKeyPairSync } from "node:crypto";
import googleAds from "../../../../codemode-plugins/googleAds/src/index.js";
import type { CredentialFixture } from "./fixture.js";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

export default {
  plugin: googleAds,
  name: "googleAds",
  // A service account added to the Google Ads account as a user: the
  // method that signs for the adwords scope by itself.
  config: {
    authMethod: "serviceAccount",
    serviceAccountEmail: "ads@project.iam.gserviceaccount.com",
    serviceAccountPrivateKey: privateKey,
    // A fresh token in the flat CLI fields, so the local run signs
    // without a token request first.
    accessToken: "ads_access",
    accessTokenExpiresAt: 4102444800000,
  },
  secrets: ["serviceAccountPrivateKey", "accessToken"],
  action: "customer.listAccessible",
  input: {},
  response: { resourceNames: ["customers/1234567890"] },
  target: "ads",
  wire: {
    url: "https://googleads.googleapis.com/v26/customers:listAccessibleCustomers",
    header: ["authorization", "Bearer ads_access"],
  },
} satisfies CredentialFixture;
