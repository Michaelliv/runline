import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { getAnswer } from "../../../runline-plugins/fxmacrodata/src/shared.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const context: ActionContext = {
  connection: { name: "fx", plugin: "fxmacrodata", config: {} },
  log: { info() {}, warn() {}, error() {} },
  async updateConnection() {},
};

function respond(payload: unknown) {
  globalThis.fetch = (async () => Response.json(payload)) as typeof fetch;
}

async function rejectsEnvelope(payload: unknown) {
  respond(payload);
  await assert.rejects(getAnswer(context, "calendar/usd"), (error: Error) =>
    error.message.includes("unexpected response") &&
    !error.message.includes("private-provider-marker"),
  );
}

it("rejects structured errors with empty data", async () => {
  await rejectsEnvelope({ error: { message: "private-provider-marker" }, data: [] });
});

it("rejects structured errors with populated data", async () => {
  await rejectsEnvelope({ error: { message: "private-provider-marker" }, data: [{ release: "synthetic" }] });
});

it("rejects array error envelopes", async () => {
  await rejectsEnvelope({ error: ["private-provider-marker"], data: [] });
});

it("rejects detail strings with empty data", async () => {
  await rejectsEnvelope({ detail: "private-provider-marker", data: [] });
});

it("rejects detail objects with empty data", async () => {
  await rejectsEnvelope({ detail: { message: "private-provider-marker" }, data: [] });
});

it("rejects detail envelopes even with populated data", async () => {
  await rejectsEnvelope({ detail: "private-provider-marker", data: [{ release: "synthetic" }] });
});

it("keeps rejecting existing string errors", async () => {
  respond({ error: "unavailable", code: "unavailable", data: [] });
  await assert.rejects(getAnswer(context, "calendar/usd"), /request failed/);
});

it("accepts null error metadata", async () => {
  const payload = { error: null, detail: null, data: [] };
  respond(payload);
  assert.deepEqual(await getAnswer(context, "calendar/usd"), payload);
});

it("accepts genuine empty data", async () => {
  respond({ data: [] });
  assert.deepEqual(await getAnswer(context, "calendar/usd"), { data: [] });
});

it("preserves successful calendar rows", async () => {
  const payload = { data: [{ release: "synthetic", announcement_datetime: 0 }] };
  respond(payload);
  assert.deepEqual(await getAnswer(context, "calendar/usd"), payload);
});

it("allows catalogue objects without a data field", async () => {
  const payload = { inflation: { name: "Inflation" } };
  respond(payload);
  assert.deepEqual(await getAnswer(context, "data_catalogue/usd"), payload);
});

it("keeps rejecting non-object responses", async () => {
  respond([]);
  await assert.rejects(getAnswer(context, "calendar/usd"), /expected a JSON object/);
});

it("rejects HTTP failure before reading its body", async () => {
  const response = new Response("private-provider-marker", { status: 500 });
  response.text = async () => { throw new Error("failed response body was read"); };
  globalThis.fetch = (async () => response) as typeof fetch;
  await assert.rejects(getAnswer(context, "calendar/usd"), /request failed.*500/);
});
