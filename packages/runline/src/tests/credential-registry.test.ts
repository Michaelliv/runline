import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as t from "typebox";
import {
  CredentialRegistry,
  OAuthGrantSchema,
  staticSecretSchema,
  validateCredential,
} from "../credentials/registry.js";
import type {
  CredentialAuthentication,
  CredentialType,
} from "../credentials/types.js";

/** A static secret of named parts, each placed as declared. */
function placed(
  parts: string[],
  placements: Extract<
    CredentialAuthentication,
    { kind: "static" }
  >["placements"],
): CredentialAuthentication {
  return { kind: "static", field: "key", parts, placements };
}

const header = (name: string, prefix?: string) =>
  placed(
    ["secret"],
    [
      {
        in: "header",
        part: "secret",
        name,
        ...(prefix === undefined ? {} : { prefix }),
      },
    ],
  );

function definition(): CredentialType {
  return {
    id: "example",
    methods: {
      apiKey: {
        schema: t.Object(
          { key: staticSecretSchema(["secret"]) },
          { additionalProperties: false },
        ),
        authentication: header("X-Api-Key"),
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
          field: "grant",
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
    validateCredential(method, { key: { secret: "secret" } });
    assert.throws(
      () =>
        validateCredential(method, {
          key: { secret: "secret" },
          extra: "private",
        }),
      { message: "Missing or invalid authentication credentials" },
    );
    assert.throws(
      () => validateCredential(method, { key: { secret: "s", extra: "p" } }),
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

  it("rejects insecure destinations, unsafe authentication shapes, missing fields, out-of-range target limits and implicit renewal", () => {
    const edits: Array<(def: CredentialType) => void> = [
      (d) => {
        d.methods.apiKey.targets.api.baseUrl = "http://api.example/v1/";
      },
      (d) => {
        d.methods.apiKey.targets.api.baseUrl = "https://api.example/v1/../";
      },
      (d) => {
        d.methods.apiKey.authentication = header("Host");
      },
      (d) => {
        d.methods.apiKey.authentication = {
          ...header("X-Api-Key"),
          field: "missing",
        };
      },
      (d) => {
        d.methods.apiKey.schema = t.Object({ key: t.String() });
      },
      (d) => {
        // The stored shape must hold exactly the declared parts, as strings.
        d.methods.apiKey.schema = t.Object(
          { key: staticSecretSchema(["secret", "extra"]) },
          { additionalProperties: false },
        );
      },
      (d) => {
        d.methods.apiKey.schema = t.Object(
          {
            key: t.Object(
              { secret: t.Number() },
              { additionalProperties: false },
            ),
          },
          { additionalProperties: false },
        );
      },
      ...["Bearer\n", " leading", "", "x".repeat(33), "café "].map(
        (prefix) => (d: CredentialType) => {
          d.methods.apiKey.authentication = header("Authorization", prefix);
        },
      ),
      (d) => {
        d.methods.apiKey.authentication = header(
          "X-Api-Key",
          7 as unknown as string,
        );
      },
      // A placement naming an undeclared part, a declared part never
      // placed, no parts, no placements, and a duplicate part.
      (d) => {
        d.methods.apiKey.authentication = placed(
          ["secret"],
          [{ in: "header", part: "other", name: "X-Api-Key" }],
        );
      },
      (d) => {
        d.methods.apiKey.authentication = placed(
          ["secret", "unused"],
          [{ in: "header", part: "secret", name: "X-Api-Key" }],
        );
      },
      (d) => {
        d.methods.apiKey.authentication = placed(
          [],
          [{ in: "header", part: "secret", name: "X-Api-Key" }],
        );
      },
      (d) => {
        d.methods.apiKey.authentication = placed(["secret"], []);
      },
      (d) => {
        d.methods.apiKey.authentication = placed(
          ["secret", "secret"],
          [{ in: "header", part: "secret", name: "X-Api-Key" }],
        );
      },
      // Two placements claiming one header, and Basic beside an
      // Authorization header.
      (d) => {
        d.methods.apiKey.authentication = placed(
          ["secret"],
          [
            { in: "header", part: "secret", name: "X-Api-Key" },
            { in: "header", part: "secret", name: "x-api-key" },
          ],
        );
      },
      (d) => {
        d.methods.apiKey.authentication = placed(
          ["username", "password"],
          [
            { in: "basic", username: "username", password: "password" },
            { in: "header", part: "password", name: "Authorization" },
          ],
        );
      },
      (d) => {
        d.methods.apiKey.authentication = placed(["secret"], [
          { in: "nowhere", part: "secret" },
        ] as never);
      },
      // A body part also reaches the query, so it cannot share a query
      // parameter's name, and its name is a plain identifier.
      (d) => {
        d.methods.apiKey.authentication = placed(
          ["secret"],
          [
            { in: "body", part: "secret", name: "key" },
            { in: "query", part: "secret", name: "KEY" },
          ],
        );
      },
      (d) => {
        d.methods.apiKey.authentication = placed(
          ["secret"],
          [{ in: "body", part: "secret", name: "api key" }],
        );
      },
      // A placement scoped to a target the method lacks; two placements
      // claiming one header on an overlapping target; an optional part the
      // stored shape still requires.
      (d) => {
        d.methods.apiKey.authentication = placed(
          ["secret"],
          [
            {
              in: "header",
              part: "secret",
              name: "X-Key",
              targets: ["missing"],
            },
          ],
        );
      },
      (d) => {
        d.methods.apiKey.schema = t.Object(
          { key: staticSecretSchema(["a", "b"]) },
          { additionalProperties: false },
        );
        d.methods.apiKey.authentication = placed(
          ["a", "b"],
          [
            { in: "header", part: "a", name: "X-Key", targets: ["api"] },
            { in: "header", part: "b", name: "X-Key" },
          ],
        );
      },
      (d) => {
        d.methods.apiKey.authentication = {
          ...placed(
            ["secret"],
            [{ in: "header", part: "secret", name: "X-Key" }],
          ),
          optionalParts: ["secret"],
        } as never;
      },
      // A target no placement signs: unsigned requests belong to a none
      // method, not to a static one.
      (d) => {
        d.methods.apiKey.targets.other = {
          baseUrl: "https://other.example/",
          methods: ["GET"],
        };
        d.methods.apiKey.authentication = placed(
          ["secret"],
          [
            {
              in: "header",
              part: "secret",
              name: "X-Key",
              targets: ["api"],
            },
          ],
        );
      },
      // One path position: two path placements, or a prefix that is not
      // plain path text.
      (d) => {
        d.methods.apiKey.schema = t.Object(
          { key: staticSecretSchema(["a", "b"]) },
          { additionalProperties: false },
        );
        d.methods.apiKey.authentication = placed(
          ["a", "b"],
          [
            { in: "path", part: "a" },
            { in: "path", part: "b" },
          ],
        );
      },
      ...["a/b", "a?", "a#", "a%2f", " ", 7].map(
        (prefix) => (d: CredentialType) => {
          d.methods.apiKey.authentication = placed(
            ["secret"],
            [{ in: "path", part: "secret", prefix: prefix as string }],
          );
        },
      ),
      ...[0, -1, 1.5, 3_600_001, "60000"].map(
        (timeoutMs) => (d: CredentialType) => {
          d.methods.apiKey.targets.api.timeoutMs = timeoutMs as number;
        },
      ),
      ...[0, 1.5, 1024 * 1024 * 1024 + 1].map(
        (maxResponseBytes) => (d: CredentialType) => {
          d.methods.apiKey.targets.api.maxResponseBytes = maxResponseBytes;
        },
      ),
      ...["", "api key", "key&x", "key=", 7].map(
        (name) => (d: CredentialType) => {
          d.methods.apiKey.authentication = placed(
            ["secret"],
            [{ in: "query", part: "secret", name: name as string }],
          );
        },
      ),
      (d) => {
        d.methods.apiKey.authentication = placed(
          ["secret"],
          [{ in: "query", part: "secret", name: "key" }],
        );
        if (d.methods.apiKey.probe) d.methods.apiKey.probe.path = "me?KEY=x";
      },
      (d) => {
        d.methods.apiKey.schema = t.Object(
          { key: staticSecretSchema(["username", "password"]) },
          { additionalProperties: false },
        );
        d.methods.apiKey.authentication = placed(
          ["username", "password"],
          [{ in: "basic", username: "username", password: "password" }],
        );
        d.methods.apiKey.targets.api.allowedHeaders = ["Authorization"];
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
      // A token endpoint's provider headers cannot claim a protocol header.
      (d) => {
        const a = d.methods.delegated.authentication;
        if (a.kind === "oauth2" && a.definition.refresh)
          a.definition.refresh.headers = { Authorization: "x" };
      },
      // A password renewal needs its endpoint, and plain field names.
      (d) => {
        const a = d.methods.delegated.authentication;
        if (a.kind === "oauth2") a.renewal = "password";
      },
      (d) => {
        const a = d.methods.delegated.authentication;
        if (a.kind !== "oauth2") return;
        a.renewal = "password";
        a.definition.password = {
          url: "https://auth.example/login",
          clientAuthentication: "none",
          fields: { username: "user name" },
        };
      },
      // A signed placement names a real header and a plain audience, and
      // its header is reserved like any other.
      ...["", "aud ience", "x".repeat(65), 7].map(
        (audience) => (d: CredentialType) => {
          d.methods.apiKey.authentication = placed(
            ["secret"],
            [
              {
                in: "jwt",
                part: "secret",
                name: "Authorization",
                audience: audience as string,
              },
            ],
          );
        },
      ),
      (d) => {
        d.methods.apiKey.authentication = placed(
          ["secret"],
          [{ in: "querySignature", part: "secret", name: "Host" }],
        );
      },
      (d) => {
        d.methods.apiKey.authentication = placed(
          ["secret"],
          [{ in: "querySignature", part: "secret", name: "X-Sig" }],
        );
        d.methods.apiKey.targets.api.allowedHeaders = ["X-Sig"];
      },
      // A socket target is wss://, signed only by query placements, and
      // only a wss:// base is a socket.
      (d) => {
        d.methods.apiKey.targets.cdp = {
          baseUrl: "https://connect.example/",
          methods: ["GET"],
          socket: true,
        };
        d.methods.apiKey.authentication = placed(
          ["secret"],
          [{ in: "query", part: "secret", name: "apiKey" }],
        );
      },
      (d) => {
        d.methods.apiKey.targets.cdp = {
          baseUrl: "wss://connect.example/",
          methods: ["GET"],
          socket: true,
        };
      },
      (d) => {
        d.methods.apiKey.targets.api.baseUrl = "wss://api.example/v1/";
      },
      (d) => {
        d.methods.delegated.targets.cdp = {
          baseUrl: "wss://connect.example/",
          methods: ["GET"],
          socket: true,
        };
      },
      // A JSON pointer is plain segments beneath the root, one per target.
      ...["", "/", "params", "/a//b", "/a~1b", "/a b", 7].map(
        (pointer) => (d: CredentialType) => {
          d.methods.apiKey.authentication = placed(
            ["secret"],
            [{ in: "jsonPointer", part: "secret", pointer: pointer as string }],
          );
        },
      ),
      (d) => {
        d.methods.apiKey.schema = t.Object(
          { key: staticSecretSchema(["a", "b"]) },
          { additionalProperties: false },
        );
        d.methods.apiKey.authentication = placed(
          ["a", "b"],
          [
            { in: "jsonPointer", part: "a", pointer: "/x/0" },
            { in: "jsonPointer", part: "b", pointer: "/x/0" },
          ],
        );
      },
      // The transport alone sets Destination; a destination gets no path
      // part, so COPY and MOVE cannot share a target with one.
      (d) => {
        d.methods.apiKey.targets.api.allowedHeaders = ["Destination"];
      },
      (d) => {
        d.methods.apiKey.targets.api.idempotency = {
          header: "Destination",
          methods: ["POST"],
        };
      },
      (d) => {
        d.methods.apiKey.targets.api.methods = ["GET", "MOVE"];
        d.methods.apiKey.authentication = placed(
          ["secret"],
          [{ in: "path", part: "secret" }],
        );
      },
    ];
    for (const edit of edits) {
      const def = definition();
      edit(def);
      assert.throws(() => new CredentialRegistry().register(def));
    }
  });

  it("registers a socket target signed by a query placement", () => {
    const def = definition();
    def.methods.apiKey.targets.cdp = {
      baseUrl: "wss://connect.example/",
      methods: ["GET"],
      socket: true,
    };
    def.methods.apiKey.authentication = placed(
      ["secret"],
      [
        { in: "header", part: "secret", name: "X-Api-Key", targets: ["api"] },
        { in: "query", part: "secret", name: "apiKey", targets: ["cdp"] },
      ],
    );
    new CredentialRegistry().register(def);
  });

  it("registers a JSON pointer placement", () => {
    const def = definition();
    def.methods.apiKey.authentication = placed(
      ["secret"],
      [{ in: "jsonPointer", part: "secret", pointer: "/params/args/2" }],
    );
    new CredentialRegistry().register(def);
  });

  it("registers the signed placements", () => {
    const def = definition();
    def.methods.apiKey.schema = t.Object(
      { key: staticSecretSchema(["id", "adminKey", "apiKey"]) },
      { additionalProperties: false },
    );
    def.methods.apiKey.authentication = placed(
      ["id", "adminKey", "apiKey"],
      [
        { in: "header", part: "id", name: "api-auth-id" },
        {
          in: "jwt",
          part: "adminKey",
          name: "Authorization",
          prefix: "Ghost ",
          audience: "/admin/",
        },
        { in: "querySignature", part: "apiKey", name: "api-auth-signature" },
      ],
    );
    new CredentialRegistry().register(def);
  });

  it("registers the WebDAV methods a target declares", () => {
    const def = definition();
    def.methods.apiKey.targets.api.methods = ["GET", "MKCOL", "COPY", "MOVE"];
    new CredentialRegistry().register(def);
  });

  it("registers HTTP Basic against its structured username/password field", () => {
    const def = definition();
    def.methods.apiKey.schema = t.Object(
      { key: staticSecretSchema(["username", "password"]) },
      { additionalProperties: false },
    );
    def.methods.apiKey.authentication = placed(
      ["username", "password"],
      [{ in: "basic", username: "username", password: "password" }],
    );
    const registry = new CredentialRegistry();
    registry.register(def);
    const method = registry.select("example", "apiKey");
    validateCredential(method, { key: { username: "u", password: "" } });
    assert.throws(() => validateCredential(method, { key: { username: "u" } }));
  });

  it("registers a secret of several parts, and one part in more than one place", () => {
    const def = definition();
    def.methods.apiKey.schema = t.Object(
      { key: staticSecretSchema(["key", "token"]) },
      { additionalProperties: false },
    );
    def.methods.apiKey.authentication = placed(
      ["key", "token"],
      [
        { in: "query", part: "key", name: "key" },
        { in: "query", part: "token", name: "token" },
        {
          in: "header",
          part: "token",
          name: "Authorization",
          prefix: "Bearer ",
        },
      ],
    );
    const registry = new CredentialRegistry();
    registry.register(def);
    validateCredential(registry.select("example", "apiKey"), {
      key: { key: "k", token: "t" },
    });
    assert.throws(() =>
      validateCredential(registry.select("example", "apiKey"), {
        key: { key: "k" },
      }),
    );
  });
});
