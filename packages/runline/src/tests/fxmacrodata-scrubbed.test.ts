import assert from "node:assert/strict";
import { it } from "node:test";
import { scrubbed } from "../../../runline-plugins/fxmacrodata/src/shared.js";

const key = "sample-redaction-token";

it("redacts an echoed key used as an object property name", () => {
  assert.deepEqual(scrubbed({ [key]: "accepted" }, key), {
    "[redacted]": "accepted",
  });
});

it("redacts every key occurrence inside a property name", () => {
  assert.deepEqual(scrubbed({ [`${key}/${key}`]: 7 }, key), {
    "[redacted]/[redacted]": 7,
  });
});

it("redacts property names nested inside arrays and objects", () => {
  const input = { data: [{ [key]: { nested: [{ [key]: key }] } }] };
  const output = scrubbed(input, key);
  assert.deepEqual(output, {
    data: [{ "[redacted]": { nested: [{ "[redacted]": "[redacted]" }] } }],
  });
  assert.ok(!JSON.stringify(output).includes(key));
  assert.ok(JSON.stringify(input).includes(key));
});

it("keeps redacting ordinary string values", () => {
  assert.deepEqual(scrubbed({ message: `accepted ${key}` }, key), {
    message: "accepted [redacted]",
  });
});

it("preserves unrelated fields and primitive types", () => {
  const input = { data: [{ indicator: "inflation", val: 3.4 }], ok: true, note: null };
  assert.deepEqual(scrubbed(input, key), input);
});

it("returns the original value when no key is held", () => {
  const input = { data: [{ [key]: key }] };
  assert.equal(scrubbed(input, undefined), input);
  assert.equal(scrubbed(input, ""), input);
});

it("matches punctuation in a key literally", () => {
  assert.deepEqual(scrubbed({ "a.b": "a.b / axb" }, "a.b"), {
    "[redacted]": "[redacted] / axb",
  });
});

it("preserves own prototype-named JSON properties", () => {
  const input = JSON.parse('{"__proto__":{"note":"ordinary"},"constructor":1}');
  const output = scrubbed(input, key);
  assert.deepEqual(output, input);
  assert.equal(Object.getPrototypeOf(output), Object.prototype);
});
