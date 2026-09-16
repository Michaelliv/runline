import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as t from "typebox";
import {
  CredentialRegistry,
  OAuthGrantSchema,
  validateCredential,
} from "../credentials/registry.js";
import type { CredentialType } from "../credentials/types.js";

function definition(): CredentialType {
  return {
    id: "example",
    methods: {
      apiKey: {
        schema: t.Object(
          { key: t.String({ minLength: 1 }) },
          { additionalProperties: false },
        ),
        authentication: { kind: "apiKey", field: "key", header: "X-Api-Key" },
        targets: {
          api: { baseUrl: "https://api.example/v1/", methods: ["GET", "POST"] },
        },
        probe: {
          target: "api",
          path: "me",
          method: "GET",
          acceptedStatuses: [200],
        },
      },
      delegated: {
        schema: t.Object(
          { grant: OAuthGrantSchema },
          { additionalProperties: false },
        ),
        authentication: {
          kind: "oauth2",
          grantField: "grant",
          renewal: "refresh",
          definition: {
            id: "example.oauth",
            provider: "example",
            refresh: {
              url: "https://auth.example/token",
              clientAuthentication: "none",
            },
          },
        },
        targets: {
          api: { baseUrl: "https://api.example/v1/", methods: ["GET"] },
        },
      },
    },
  };
}

describe("credential registry", () => {
  it("selects explicit methods and validates their own strict schemas without leaking values", () => {
    const registry = new CredentialRegistry();
    registry.register(definition());
    const method = registry.select("example", "apiKey");
    validateCredential(method, { key: "secret" });
    assert.throws(
      () => validateCredential(method, { key: "secret", extra: "private" }),
      { message: "Missing or invalid authentication credentials" },
    );
    assert.throws(() => registry.select("example", ""));
    assert.throws(() => registry.select("example", "toString"));
    assert.throws(() => registry.select("missing", "apiKey"));
    validateCredential(registry.select("example", "delegated"), {
      grant: { tokens: { accessToken: "a" }, revision: "initial" },
    });
    assert.throws(() =>
      validateCredential(registry.select("example", "delegated"), { key: "a" }),
    );
  });

  it("pins declarations and returns detached copies; duplicate types cannot replace live policy", () => {
    const registry = new CredentialRegistry();
    const def = definition();
    registry.register(def);
    def.methods.apiKey.targets.api.baseUrl = "https://evil.example/";
    registry.select("example", "apiKey").targets.api.baseUrl =
      "https://evil.example/";
    registry.list()[0].methods.apiKey.targets.api.methods.push("DELETE");
    assert.equal(
      registry.select("example", "apiKey").targets.api.baseUrl,
      "https://api.example/v1/",
    );
    assert.deepEqual(registry.select("example", "apiKey").targets.api.methods, [
      "GET",
      "POST",
    ]);
    assert.throws(() => registry.register(def));
  });

  it("rejects unsafe or undeclared probes rather than guessing an action", () => {
    for (const probe of [
      { target: "api", path: "me", method: "POST", acceptedStatuses: [200] },
      { target: "unknown", path: "me", method: "GET", acceptedStatuses: [200] },
      {
        target: "api",
        path: "https://evil.example/",
        method: "GET",
        acceptedStatuses: [200],
      },
      {
        target: "api",
        path: "../admin",
        method: "GET",
        acceptedStatuses: [200],
      },
      { target: "api", path: "me", method: "GET", acceptedStatuses: [403] },
    ]) {
      const def = definition();
      def.methods.apiKey.probe = probe as typeof def.methods.apiKey.probe;
      assert.throws(() => new CredentialRegistry().register(def));
    }
    const registry = new CredentialRegistry();
    registry.register(definition());
    assert.equal(registry.select("example", "delegated").probe, undefined);
  });

  it("rejects insecure destinations, header routing controls, missing fields and implicit renewal", () => {
    const edits: Array<(def: CredentialType) => void> = [
      (d) => {
        d.methods.apiKey.targets.api.baseUrl = "http://api.example/v1/";
      },
      (d) => {
        d.methods.apiKey.targets.api.baseUrl = "https://api.example/v1/../";
      },
      (d) => {
        d.methods.apiKey.authentication = {
          kind: "apiKey",
          field: "key",
          header: "Host",
        };
      },
      (d) => {
        d.methods.apiKey.authentication = { kind: "bearer", field: "missing" };
      },
      (d) => {
        d.methods.apiKey.schema = t.Object({ key: t.String() });
      },
      (d) => {
        d.methods.apiKey.targets.api.allowedHeaders =
          "Accept" as unknown as string[];
      },
      (d) => {
        d.methods.apiKey.targets.api.allowedHeaders = ["X-Api-Key"];
      },
      (d) => {
        const a = d.methods.delegated.authentication;
        if (a.kind === "oauth2") a.renewal = "clientCredentials";
      },
    ];
    for (const edit of edits) {
      const def = definition();
      edit(def);
      assert.throws(() => new CredentialRegistry().register(def));
    }
  });
});
