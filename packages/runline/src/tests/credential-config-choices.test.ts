/**
 * A config field that picks among documented hosts or environments takes
 * only its documented values; anything else is refused before any
 * request, never mapped to a default that sends the credential elsewhere.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { configChoice } from "../../../runline-plugins/_shared/credentials.js";
import { bitwardenCredential } from "../../../runline-plugins/bitwarden/src/credentials.js";
import { bubbleCredential } from "../../../runline-plugins/bubble/src/credentials.js";
import { contentfulCredential } from "../../../runline-plugins/contentful/src/credentials.js";
import { customerIoCredential } from "../../../runline-plugins/customerIo/src/credentials.js";
import { deeplCredential } from "../../../runline-plugins/deepl/src/credentials.js";
import { gristCredential } from "../../../runline-plugins/grist/src/credentials.js";
import { halopsaCredential } from "../../../runline-plugins/halopsa/src/credentials.js";
import { mailgunRegion } from "../../../runline-plugins/mailgun/src/credentials.js";
import { paypalCredential } from "../../../runline-plugins/paypal/src/credentials.js";

const refused = { code: "invalid_credentials" };

describe("configChoice", () => {
  it("takes a documented value, the fallback when absent, and refuses anything else", () => {
    const choices = ["us", "eu"] as const;
    assert.equal(configChoice("eu", choices, "us"), "eu");
    assert.equal(configChoice(undefined, choices, "us"), "us");
    assert.equal(configChoice(null, choices, "us"), "us");
    for (const value of ["EU", "", "toString", 1, true])
      assert.throws(() => configChoice(value, choices, "us"), refused);
  });
});

describe("plugins choosing hosts from config", () => {
  it("refuse an undocumented value in every field that picks a host", () => {
    const cases: Array<() => unknown> = [
      () =>
        bitwardenCredential({
          environment: "self-hosted",
          domain: "https://vault.example.com",
        }),
      () =>
        bubbleCredential({
          hosting: "self-hosted",
          appName: "app",
          domain: "https://app.example.com",
        }),
      () => bubbleCredential({ appName: "app", environment: "dev" }),
      () => paypalCredential({ env: "production" }),
      () => customerIoCredential({ region: "eu" }),
      () => mailgunRegion({ apiDomain: "api.mailgun.org" }),
      () => contentfulCredential({ source: "Preview" }),
      () => deeplCredential({ plan: "professional" }),
      () => gristCredential({ planType: "team", subdomain: "acme" }),
      () =>
        halopsaCredential({
          hostingType: "onPremise",
          appUrl: "https://halo.example.com",
          authUrl: "https://auth.halo.example.com",
          resourceApiUrl: "https://halo.example.com/api",
        }),
    ];
    for (const run of cases) assert.throws(run, refused);
  });

  it("keep their defaults and documented values", () => {
    assert.equal(
      bitwardenCredential({ environment: "cloudHosted" }).type.methods.oauth2
        .targets.api.baseUrl,
      "https://api.bitwarden.com/public/",
    );
    assert.equal(
      bubbleCredential({ appName: "app", environment: "development" }).type
        .methods.bearer.targets.api.baseUrl,
      "https://app.bubbleapps.io/version-test/api/1.1/",
    );
    assert.equal(
      paypalCredential({ env: "live" }).type.methods.oauth2.targets.api.baseUrl,
      "https://api-m.paypal.com/v1/",
    );
    assert.equal(
      paypalCredential({}).type.methods.oauth2.targets.api.baseUrl,
      "https://api-m.sandbox.paypal.com/v1/",
    );
    assert.equal(mailgunRegion({}), "us");
  });
});
