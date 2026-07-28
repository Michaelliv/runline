import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { Check } from "typebox/value";
import shiftObjects from "../../../runline-plugins/shiftObjects/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;

const SHIFT_OBJECTS_ACTIONS = [
  "object.archive",
  "object.attach",
  "object.bucket",
  "object.download",
  "object.get",
  "object.links",
  "object.list",
  "object.upload",
] as const;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeShiftObjects(): PluginDef {
  const { api, resolve } = createPluginAPI("shiftObjects");
  shiftObjects(api);
  return resolve();
}

function getAction(plugin: PluginDef, name: string) {
  const action = plugin.actions.find((a) => a.name === name);
  assert.ok(action, `expected shiftObjects.${name} to be registered`);
  return action;
}

function ctx(): ActionContext {
  return {
    connection: {
      name: "shiftObjects",
      plugin: "shiftObjects",
      config: { apiKey: "shift_test" },
    },
    log: {
      info() {},
      warn() {},
      error() {},
    },
    async updateConnection() {},
  };
}

function mockShift(assertRequest: (input: URL, init?: RequestInit) => unknown) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const data = assertRequest(input as URL, init);
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("shiftObjects plugin", () => {
  it("registers the durable objects surface", () => {
    const plugin = makeShiftObjects();
    assert.equal(plugin.name, "shiftObjects");
    assert.deepEqual(plugin.actions.map((a) => a.name).sort(), [
      ...SHIFT_OBJECTS_ACTIONS,
    ]);
  });

  it("strictly validates every action schema", () => {
    for (const action of makeShiftObjects().actions) {
      const schema = action.inputSchema as {
        type?: string;
        additionalProperties?: boolean;
      };
      assert.equal(schema.type, "object", action.name);
      assert.equal(schema.additionalProperties, false, action.name);
    }
  });

  it("uploads an object end to end: create, upload, complete", async () => {
    const action = getAction(makeShiftObjects(), "object.upload");
    const directory = await mkdtemp(join(tmpdir(), "shift-objects-"));
    const file = join(directory, "delivery-note.jpg");
    await writeFile(file, "image-bytes");

    const calls: string[] = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/v1/services/objects/objects")) {
        // The API key is the tenant authority; no organizationId is sent.
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("authorization"), "Bearer shift_test");
        assert.deepEqual(JSON.parse(String(init?.body)), {
          contentType: "image/jpeg",
          sizeBytes: 11,
          filename: "delivery-note.jpg",
          sessionId: "sess_1",
        });
        return Response.json({
          object: { id: "object_1", status: "pending_upload" },
          upload: {
            method: "PUT",
            url: "https://uploads.invalid/object_1",
            headers: { "content-type": "image/jpeg" },
            expiresAt: "2026-07-20T12:15:00.000Z",
          },
        });
      }
      if (url === "https://uploads.invalid/object_1") {
        assert.equal(init?.method, "PUT");
        return new Response(null, { status: 200 });
      }
      if (url.endsWith("/objects/object_1/complete")) {
        assert.equal(init?.method, "POST");
        return Response.json({
          id: "object_1",
          status: "ready",
          checksum: "etag-1",
        });
      }
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;

    assert.deepEqual(
      await action.execute({ path: file, sessionId: "sess_1" }, ctx()),
      { id: "object_1", status: "ready", checksum: "etag-1" },
    );
    assert.equal(calls.length, 3);
  });

  it("rejects empty objects before any network call", async () => {
    const action = getAction(makeShiftObjects(), "object.upload");
    const directory = await mkdtemp(join(tmpdir(), "shift-objects-"));
    const empty = join(directory, "empty.pdf");
    await writeFile(empty, "");

    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("fetch should not run");
    }) as typeof fetch;

    await assert.rejects(
      () => action.execute({ path: empty }, ctx()),
      /File is empty/,
    );
    assert.equal(fetchCalls, 0);
  });

  it("validates object link payloads strictly", () => {
    const attach = getAction(makeShiftObjects(), "object.attach");
    assert.equal(
      Check(attach.inputSchema as never, {
        id: "object_1",
        links: [
          {
            targetType: "db_record",
            targetId: "R2M_Sys/GoodsReceiptLog/42",
            role: "source",
          },
        ],
      }),
      true,
    );
    assert.equal(
      Check(attach.inputSchema as never, { id: "object_1", links: [] }),
      false,
    );
    assert.equal(
      Check(attach.inputSchema as never, {
        id: "object_1",
        links: [{ targetType: "table", targetId: "x" }],
      }),
      false,
    );
  });

  it("returns download grants and optionally saves bytes to disk", async () => {
    const action = getAction(makeShiftObjects(), "object.download");
    const directory = await mkdtemp(join(tmpdir(), "shift-objects-"));
    const savePath = join(directory, "restored.jpg");
    const grant = {
      method: "GET" as const,
      url: "https://downloads.invalid/object_1",
      expiresAt: "2026-07-20T12:05:00.000Z",
    };

    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.endsWith("/objects/object_1/download")) {
        assert.equal(init?.method, "POST");
        return Response.json(grant);
      }
      if (url === grant.url) return new Response("image-bytes");
      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch;

    assert.deepEqual(await action.execute({ id: "object_1" }, ctx()), grant);
    assert.deepEqual(
      await action.execute({ id: "object_1", savePath }, ctx()),
      { savedTo: savePath, sizeBytes: 11 },
    );
    assert.equal(await readFile(savePath, "utf8"), "image-bytes");
  });

  it("lists objects with service filters", async () => {
    const action = getAction(makeShiftObjects(), "object.list");

    mockShift((input) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/v1/services/objects/objects");
      assert.equal(url.searchParams.get("sessionId"), "sess_1");
      assert.equal(url.searchParams.get("status"), "ready");
      return { objects: [{ id: "object_1", status: "ready" }] };
    });

    assert.deepEqual(
      await action.execute({ sessionId: "sess_1", status: "ready" }, ctx()),
      [{ id: "object_1", status: "ready" }],
    );
  });
});
