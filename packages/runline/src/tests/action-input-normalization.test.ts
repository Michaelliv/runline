import assert from "node:assert/strict";
import { describe, it } from "node:test";
import gmail from "../../../runline-plugins/gmail/src/index.js";
import { dropUndefined, normalizeActionInput } from "../plugin/schema.js";
import { Runline } from "../sdk.js";
import { stubFetch } from "./helpers/plugin.js";

describe("action input normalization", () => {
  it("drops undefined-valued keys at every depth of plain objects", () => {
    assert.deepEqual(
      dropUndefined({
        a: undefined,
        b: null,
        c: { d: undefined, e: 0, f: [{ g: undefined, h: "" }] },
      }),
      { b: null, c: { e: 0, f: [{ h: "" }] } },
    );
  });
  it("keeps arrays' length, non-plain objects and own __proto__ keys intact", () => {
    const bytes = Buffer.from("x");
    const date = new Date(0);
    const out = dropUndefined({ list: [undefined, 1], bytes, date }) as {
      list: unknown[];
      bytes: unknown;
      date: unknown;
    };
    assert.deepEqual(out.list, [undefined, 1]);
    assert.equal(out.bytes, bytes);
    assert.equal(out.date, date);
    const hostile = dropUndefined(JSON.parse('{"__proto__":{"polluted":1}}'));
    assert.equal(({} as { polluted?: number }).polluted, undefined);
    assert.ok(Object.hasOwn(hostile as object, "__proto__"));
  });
  it("treats no arguments as an empty set and scalars as given", () => {
    assert.deepEqual(normalizeActionInput(undefined), {});
    assert.equal(normalizeActionInput(null), null);
    assert.equal(normalizeActionInput(42), 42);
  });
  it("lets neither execution nor actions.check count an undefined field as given", async () => {
    const originalFetch = globalThis.fetch;
    let fetched = 0;
    stubFetch(async () => {
      fetched++;
      return Response.json({ id: "x" });
    });
    try {
      const rl = Runline.create({
        plugins: [gmail],
        connections: [
          {
            name: "t",
            plugin: "gmail",
            config: {
              accessToken: "token",
              accessTokenExpiresAt: Date.now() + 3_600_000,
            },
          },
        ],
      });
      const call = await rl.execute(
        `return await gmail.label.update({ id: "x", name: undefined });`,
      );
      assert.match(call.error ?? "", /Invalid input for gmail\.label\.update/);
      assert.equal(fetched, 0);
      const check = await rl.execute(
        `return actions.check("gmail.label.update", { id: "x", name: undefined });`,
      );
      assert.equal((check.result as { ok: boolean }).ok, false);
      const given = await rl.execute(
        `return actions.check("gmail.label.update", { id: "x", name: "Renamed" });`,
      );
      assert.equal((given.result as { ok: boolean }).ok, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
