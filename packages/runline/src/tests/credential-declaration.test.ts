/**
 * Credential declarations: a registry-backed plugin states, on its
 * definition, how a connection's config becomes a signing selection —
 * credential type (targets, token endpoints, scopes), method, OAuth
 * application, JWT identity. A host that signs for the plugin (the
 * broker) builds requests from this declaration, read from the trusted
 * plugin it loaded itself, never from anything the plugin's process
 * sends; the local signer reads the same declaration, so the two cannot
 * disagree.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import github from "../../../runline-plugins/github/src/index.js";
import gmail from "../../../runline-plugins/gmail/src/index.js";
import googleAppsScript from "../../../runline-plugins/googleAppsScript/src/index.js";
import googleCalendar from "../../../runline-plugins/googleCalendar/src/index.js";
import googleContacts from "../../../runline-plugins/googleContacts/src/index.js";
import googleDocs from "../../../runline-plugins/googleDocs/src/index.js";
import googleDrive from "../../../runline-plugins/googleDrive/src/index.js";
import googleSheets from "../../../runline-plugins/googleSheets/src/index.js";
import googleSlides from "../../../runline-plugins/googleSlides/src/index.js";
import googleTasks from "../../../runline-plugins/googleTasks/src/index.js";
import microsoftCalendar from "../../../runline-plugins/microsoftCalendar/src/index.js";
import microsoftFiles from "../../../runline-plugins/microsoftFiles/src/index.js";
import microsoftMail from "../../../runline-plugins/microsoftMail/src/index.js";
import plaud from "../../../runline-plugins/plaud/src/index.js";
import type { CredentialDeclaration } from "../credentials/types.js";
import { createPluginAPI, type PluginFunction } from "../plugin/api.js";
import type { PluginDef } from "../plugin/types.js";

function definition(plugin: PluginFunction): PluginDef {
  const { api, resolve } = createPluginAPI("test");
  plugin(api);
  return resolve();
}

const delegated = {
  clientId: "client",
  clientSecret: "secret",
  refreshToken: "r",
};

describe("the plugin API carries a credential declaration", () => {
  it("setCredential puts it on the definition", () => {
    const declaration: CredentialDeclaration = () => {
      throw new Error("never called here");
    };
    const { api, resolve } = createPluginAPI("probe");
    api.setCredential(declaration);
    assert.equal(resolve().credential, declaration);
  });

  it("a plugin that signs its own requests declares none", () => {
    assert.equal(definition(github).credential, undefined);
  });
});

describe("registry-backed plugins declare their credential", () => {
  const specs: Array<[PluginFunction, string, string, string[]]> = [
    [gmail, "gmail", "google.oauth", ["gmail"]],
    [googleAppsScript, "googleAppsScript", "google.oauth", ["drive", "script"]],
    [googleCalendar, "googleCalendar", "google.oauth", ["calendar"]],
    [googleContacts, "googleContacts", "google.oauth", ["people"]],
    [googleDocs, "googleDocs", "google.oauth", ["docs", "drive"]],
    [googleDrive, "googleDrive", "google.oauth", ["docs", "drive", "upload"]],
    [googleSheets, "googleSheets", "google.oauth", ["drive", "sheets"]],
    [googleSlides, "googleSlides", "google.oauth", ["slides"]],
    [googleTasks, "googleTasks", "google.oauth", ["tasks"]],
    [microsoftMail, "microsoftMail", "microsoft.graph", ["graph"]],
    [microsoftCalendar, "microsoftCalendar", "microsoft.graph", ["graph"]],
    [microsoftFiles, "microsoftFiles", "microsoft.graph", ["graph"]],
    [plaud, "plaud", "plaud", ["api"]],
  ];

  for (const [plugin, name, typeId, targets] of specs) {
    it(`${name}: its type, targets, method and application`, () => {
      const declare = definition(plugin).credential;
      assert.ok(declare, `${name} declares no credential`);
      const selection = declare(delegated);
      assert.equal(selection.type.id, typeId);
      const method = selection.type.methods[selection.method];
      assert.ok(method, `${name} selects an undeclared method`);
      assert.deepEqual(Object.keys(method.targets).sort(), targets);
      assert.equal(selection.application?.clientId, "client");
    });
  }

  it("Google and Microsoft sign for exactly the scopes their consent asks for", () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const serviceAccount = {
      serviceAccountEmail: "robot@example.com",
      serviceAccountPrivateKey: privateKey,
    };
    for (const plugin of [
      gmail,
      googleCalendar,
      googleContacts,
      googleDocs,
      googleDrive,
      googleSheets,
      googleSlides,
      googleTasks,
    ]) {
      const def = definition(plugin);
      const selection = def.credential?.(serviceAccount);
      assert.equal(selection?.method, "serviceAccount", def.name);
      const auth = selection?.type.methods.serviceAccount.authentication;
      assert.equal(auth?.kind, "oauth2");
      assert.deepEqual(
        auth?.kind === "oauth2" ? auth.scopes : undefined,
        def.oauth?.scopes,
        def.name,
      );
      assert.equal(selection?.jwtIdentity?.issuer, "robot@example.com");
    }
    for (const plugin of [microsoftMail, microsoftCalendar, microsoftFiles]) {
      const def = definition(plugin);
      const auth =
        def.credential?.(delegated).type.methods.delegated.authentication;
      assert.deepEqual(
        auth?.kind === "oauth2" ? auth.scopes : undefined,
        def.oauth?.scopes,
        def.name,
      );
    }
  });

  it("a delegation subject comes from the connection, never from anywhere else", () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const selection = definition(gmail).credential?.({
      serviceAccountEmail: "robot@example.com",
      serviceAccountPrivateKey: privateKey,
      serviceAccountSubject: "dana@example.com",
    });
    assert.equal(selection?.jwtIdentity?.subject, "dana@example.com");
  });

  it("Microsoft app-only refuses a multi-tenant authority at declaration", () => {
    const declare = definition(microsoftMail).credential;
    for (const tenantId of [
      undefined,
      "common",
      "organizations",
      "consumers",
    ]) {
      assert.throws(
        () =>
          declare?.({
            authMethod: "appOnly",
            clientId: "client",
            clientSecret: "secret",
            tenantId,
          }),
        { code: "invalid_credentials" },
      );
    }
    assert.equal(
      declare?.({
        authMethod: "appOnly",
        clientId: "client",
        clientSecret: "secret",
        tenantId: "contoso",
      }).method,
      "appOnly",
    );
  });
});
