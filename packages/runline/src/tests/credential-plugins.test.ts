/**
 * Every plugin that declares its credential, run from its fixture
 * (credential-fixtures/<plugin>.ts) three ways:
 *
 *   - brokered: a host broker and a connection config with no secret in
 *     it. The plugin never calls fetch, attaches no credential of its own,
 *     and no secret value appears anywhere in what it asks the broker for;
 *   - locally: the flat CLI config it has always used. The first request
 *     goes to the same destination with the same auth header as before,
 *     a redirect is refused rather than followed, and a provider's error
 *     text never reaches the caller;
 *   - declared: the declaration needs no secret to select its credential,
 *     registers in a fresh registry, names only fixture secrets as its
 *     local fields, and an OAuth method signs for exactly the scopes the
 *     plugin's consent asks for.
 */

import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CredentialRegistry } from "../credentials/registry.js";
import type {
  AuthenticatedRequest,
  CredentialBroker,
} from "../credentials/transport.js";
import type { CredentialSelection } from "../credentials/types.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";
import type { CredentialFixture } from "./credential-fixtures/fixture.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "credential-fixtures");

async function loadFixtures(): Promise<CredentialFixture[]> {
  const names = readdirSync(FIXTURES)
    .filter((name) => name.endsWith(".ts") && name !== "fixture.ts")
    .sort();
  const fixtures: CredentialFixture[] = [];
  for (const name of names) {
    const module = (await import(join(FIXTURES, name))) as {
      default: CredentialFixture;
    };
    assert.equal(
      `${module.default.name}.ts`,
      name,
      `${name} must describe the plugin it is named for`,
    );
    fixtures.push(module.default);
  }
  return fixtures;
}

const fixtures = await loadFixtures();

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function definition(fixture: CredentialFixture): PluginDef {
  const { api, resolve } = createPluginAPI("test");
  fixture.plugin(api);
  const def = resolve();
  assert.equal(def.name, fixture.name);
  return def;
}

function action(fixture: CredentialFixture) {
  const found = definition(fixture).actions.find(
    (a) => a.name === fixture.action,
  );
  assert.ok(found, `${fixture.name} has no action ${fixture.action}`);
  return found;
}

function publicConfig(fixture: CredentialFixture): Record<string, unknown> {
  const config = { ...fixture.config };
  for (const field of fixture.secrets) delete config[field];
  return config;
}

function selection(fixture: CredentialFixture): CredentialSelection {
  const declare = definition(fixture).credential;
  assert.ok(declare, `${fixture.name} declares no credential`);
  return declare(publicConfig(fixture));
}

/** Header names a plugin must never set itself: the ones its transport injects. */
function injectedHeaders(fixture: CredentialFixture): string[] {
  const { type, method } = selection(fixture);
  const auth = type.methods[method].authentication;
  return [
    "authorization",
    ...(auth.kind === "static"
      ? auth.placements.flatMap((placement) =>
          placement.in === "header" ? [placement.name.toLowerCase()] : [],
        )
      : []),
  ];
}

function secretValues(fixture: CredentialFixture): string[] {
  return fixture.secrets
    .map((field) => fixture.config[field])
    .filter((value): value is string => typeof value === "string" && !!value);
}

function context(
  fixture: CredentialFixture,
  config: Record<string, unknown>,
  credentials?: CredentialBroker,
): ActionContext {
  const connection = { name: fixture.name, plugin: fixture.name, config };
  return {
    connection,
    ...(credentials ? { credentials } : {}),
    log: { info() {}, warn() {}, error() {} },
    async updateConnection(change) {
      if (credentials)
        throw new Error("a brokered plugin persists nothing itself");
      const patch =
        typeof change === "function" ? await change(connection.config) : change;
      if (patch) connection.config = { ...connection.config, ...patch };
    },
  };
}

function wire(handler: (url: string, init: RequestInit) => Response) {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), init: init ?? {} });
    return handler(String(input), init ?? {});
  }) as typeof fetch;
  return seen;
}

describe("credential fixtures", () => {
  it("load, each named for the plugin it describes", () => {
    assert.ok(fixtures.length > 0);
  });
});

for (const fixture of fixtures) {
  describe(`${fixture.name} signs through its declared credential`, () => {
    it("brokered: no secret in config, no fetch, no credential of its own", async () => {
      globalThis.fetch = (async () => {
        throw new Error("a brokered plugin must not reach the network itself");
      }) as unknown as typeof fetch;
      const requests: AuthenticatedRequest[] = [];
      const broker: CredentialBroker = {
        async request(input) {
          requests.push(input);
          return Response.json(fixture.response);
        },
        async probe() {
          return { outcome: "unverified" };
        },
      };
      await action(fixture).execute(
        fixture.input,
        context(fixture, publicConfig(fixture), broker),
      );
      assert.ok(
        requests.length > 0,
        `${fixture.name} made no brokered request`,
      );
      assert.equal(requests[0].target, fixture.target);
      const injected = injectedHeaders(fixture);
      for (const request of requests) {
        for (const name of Object.keys(request.headers ?? {}))
          assert.ok(
            !injected.includes(name.toLowerCase()),
            `${fixture.name} sets its own ${name} header`,
          );
        const sent = JSON.stringify({
          ...request,
          body:
            request.body instanceof Uint8Array
              ? Buffer.from(request.body).toString()
              : request.body,
        });
        for (const value of secretValues(fixture))
          assert.ok(!sent.includes(value), `${fixture.name} sends a secret`);
      }
    });

    it("locally: the same destination and auth header as before", async () => {
      const seen = wire(() => Response.json(fixture.response));
      await action(fixture).execute(
        fixture.input,
        context(fixture, { ...fixture.config }),
      );
      assert.ok(seen.length > 0, `${fixture.name} made no request`);
      assert.equal(seen[0].url, fixture.wire.url);
      assert.equal(seen[0].init.redirect, "error");
      if (fixture.wire.header) {
        const [name, value] = fixture.wire.header;
        assert.equal(new Headers(seen[0].init.headers).get(name), value);
      }
      if (fixture.wire.field) {
        const [name, value] = fixture.wire.field;
        const body = Buffer.from(seen[0].init.body as Uint8Array).toString();
        const fields = new Headers(seen[0].init.headers)
          .get("content-type")
          ?.includes("json")
          ? (JSON.parse(body) as Record<string, unknown>)
          : Object.fromEntries(new URLSearchParams(body));
        assert.equal(fields[name], value);
      }
    });

    it("locally: refuses a redirect and does not follow it", async () => {
      const seen = wire(
        () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://evil.example/" },
          }),
      );
      await assert.rejects(
        Promise.resolve(
          action(fixture).execute(
            fixture.input,
            context(fixture, { ...fixture.config }),
          ),
        ),
      );
      assert.equal(seen.length, 1);
    });

    it("locally: a provider error reaches the caller without its text", async () => {
      wire(() => new Response("private-provider-detail", { status: 400 }));
      await assert.rejects(
        Promise.resolve(
          action(fixture).execute(
            fixture.input,
            context(fixture, { ...fixture.config }),
          ),
        ),
        (error: unknown) =>
          !String(error).includes("private-provider-detail") &&
          !String((error as Error)?.stack).includes("private-provider-detail"),
      );
    });

    it("declared: selects with no secret, registers, and signs for the consented scopes", () => {
      const selected = selection(fixture);
      new CredentialRegistry().register(selected.type);
      for (const source of Object.values(selected.localSecret ?? {}))
        for (const part of "concat" in source ? source.concat : [source])
          if ("field" in part)
            assert.ok(
              fixture.secrets.includes(part.field),
              `${fixture.name} signs locally from ${part.field}, which its fixture does not list as a secret`,
            );
      const def = definition(fixture);
      const auth = selected.type.methods[selected.method].authentication;
      if (auth.kind === "oauth2" && def.oauth)
        assert.deepEqual(auth.scopes ?? [], def.oauth.scopes);
    });
  });
}
