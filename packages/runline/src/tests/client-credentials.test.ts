import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import bitwarden from "../../../runline-plugins/bitwarden/src/index.js";
import halopsa from "../../../runline-plugins/halopsa/src/index.js";
import paypal from "../../../runline-plugins/paypal/src/index.js";
import { MemoryConnectionProvider } from "../connections/memory.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

for (const spec of [
  {
    name: "paypal",
    plugin: paypal,
    action: "payoutItem.get",
    input: { payoutItemId: "item" },
    config: { env: "sandbox" },
  },
  {
    name: "bitwarden",
    plugin: bitwarden,
    action: "collection.get",
    input: { collectionId: "item" },
    config: {},
  },
  {
    name: "halopsa",
    plugin: halopsa,
    action: "client.get",
    input: { id: 1 },
    config: {
      authUrl: "https://auth.example",
      resourceApiUrl: "https://api.example",
      tenant: "tenant&grant_type=bad",
    },
  },
]) {
  describe(`${spec.name} connection-owned tokens`, () => {
    it("isolates accounts and serializes concurrent acquisition within each account", async () => {
      const { api, resolve } = createPluginAPI(spec.name);
      spec.plugin(api);
      const action = resolve().actions.find((a) => a.name === spec.action);
      assert.ok(action);
      const calls: string[] = [];
      globalThis.fetch = (async (url, init) => {
        const headers = new Headers(init?.headers);
        if (String(url).includes("/token")) {
          assert.equal(init?.redirect, "error");
          let clientId = new URLSearchParams(String(init?.body)).get(
            "client_id",
          );
          if (headers.has("authorization")) {
            clientId = Buffer.from(
              headers.get("authorization")?.slice(6) ?? "",
              "base64",
            )
              .toString()
              .split(":")[0];
          }
          assert.ok(clientId);
          calls.push(clientId);
          if (spec.name === "halopsa") {
            assert.equal(
              new URL(String(url)).searchParams.get("tenant"),
              "tenant&grant_type=bad",
            );
            assert.equal(
              new URL(String(url)).searchParams.has("grant_type"),
              false,
            );
          }
          await new Promise((r) => setTimeout(r, 10));
          return Response.json({
            access_token: `token-${clientId}`,
            expires_in: 3600,
          });
        }
        return Response.json({ authorization: headers.get("authorization") });
      }) as typeof fetch;
      const stores = ["alice", "bob"].map(
        (clientId) =>
          new MemoryConnectionProvider([
            {
              name: "account",
              plugin: spec.name,
              config: {
                ...spec.config,
                clientId,
                clientSecret: "secret",
                secret: "secret",
              },
            },
          ]),
      );
      const invoke = async (store: MemoryConnectionProvider) => {
        const handle = await store.resolve({ plugin: spec.name });
        const connection = await handle.read();
        const ctx: ActionContext = {
          connection,
          log: { info() {}, warn() {}, error() {} },
          async updateConnection(change) {
            connection.config = (await handle.update(change)).config;
          },
        };
        return action.execute(spec.input, ctx);
      };
      const results = await Promise.all(
        stores.flatMap((store) => [invoke(store), invoke(store)]),
      );
      assert.deepEqual(results, [
        { authorization: "Bearer token-alice" },
        { authorization: "Bearer token-alice" },
        { authorization: "Bearer token-bob" },
        { authorization: "Bearer token-bob" },
      ]);
      assert.deepEqual(calls.sort(), ["alice", "bob"]);
      await invoke(stores[0]);
      assert.equal(calls.length, 2);
    });
  });
}
