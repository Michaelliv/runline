import assert from "node:assert/strict";
import { mkdtemp, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { Check } from "typebox/value";
import shiftOcr from "../../../runline-plugins/shiftOcr/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeShiftOcr(): PluginDef {
  const { api, resolve } = createPluginAPI("shiftOcr");
  shiftOcr(api);
  return resolve();
}

function getAction(plugin: PluginDef, name: string) {
  const action = plugin.actions.find((a) => a.name === name);
  assert.ok(action, `expected shiftOcr.${name} to be registered`);
  return action;
}

function ctx(): ActionContext {
  return {
    connection: {
      name: "shiftOcr",
      plugin: "shiftOcr",
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

function refusingFetch(): () => number {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("fetch should not run");
  }) as typeof fetch;
  return () => calls;
}

describe("shiftOcr plugin", () => {
  it("registers the Shift OCR plugin with extract and providers actions", () => {
    const plugin = makeShiftOcr();
    assert.equal(plugin.name, "shiftOcr");
    assert.deepEqual(plugin.actions.map((a) => a.name).sort(), [
      "ocr.extract",
      "ocr.providers",
    ]);
  });

  it("strictly validates every Shift OCR action schema", () => {
    for (const action of makeShiftOcr().actions) {
      const schema = action.inputSchema as {
        type?: string;
        additionalProperties?: boolean;
      };
      assert.equal(schema.type, "object", action.name);
      assert.equal(schema.additionalProperties, false, action.name);
    }
  });

  it("validates the extract contract strictly", () => {
    const extract = getAction(makeShiftOcr(), "ocr.extract");
    assert.ok(extract.inputSchema);
    const check = (value: unknown) =>
      Check(extract.inputSchema as never, value);

    assert.equal(check({ path: "/tmp/label.jpg" }), true);
    assert.equal(check({ url: "https://cdn.invalid/scan.pdf" }), true);
    assert.equal(
      check({
        path: "/tmp/label.jpg",
        schema: { type: "object" },
        schemaName: "r2m.pakaLabel",
        prompt: "Dates are DD/MM/YYYY.",
      }),
      true,
    );
    assert.equal(
      check({ url: "https://cdn.invalid/scan.pdf", pages: "0-5" }),
      true,
    );
    assert.equal(check({ path: " " }), false);
    assert.equal(check({ path: "/tmp/a.jpg", pages: "last" }), false);
    assert.equal(check({ path: "/tmp/a.jpg", kind: "video" }), false);
    assert.equal(check({ path: "/tmp/a.jpg", unknown: true }), false);
  });

  it("extracts a local image as a base64 data URL", async () => {
    const action = getAction(makeShiftOcr(), "ocr.extract");
    const directory = await mkdtemp(join(tmpdir(), "shift-ocr-plugin-"));
    const image = join(directory, "label.png");
    await writeFile(image, "image-bytes");

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://cloud.shift-labs.ai/v1/services/ocr/extract",
      );
      assert.equal(init?.method, "POST");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer shift_test");
      // The API key is the tenant authority; no organizationId is sent.
      assert.deepEqual(JSON.parse(String(init?.body)), {
        document: {
          type: "image",
          url: `data:image/png;base64,${Buffer.from("image-bytes").toString("base64")}`,
        },
      });
      return { provider: "mistral-ocr", pages: [], pagesProcessed: 1 };
    });

    assert.deepEqual(await action.execute({ path: image }, ctx()), {
      provider: "mistral-ocr",
      pages: [],
      pagesProcessed: 1,
    });
  });

  it("sends structured extraction with a default extractor name", async () => {
    const action = getAction(makeShiftOcr(), "ocr.extract");

    mockShift((_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.deepEqual(body.structured, {
        name: "extraction",
        schema: { type: "object" },
      });
      assert.deepEqual(body.document, {
        type: "image",
        url: "https://cdn.invalid/label.jpg",
      });
      return { pagesProcessed: 1 };
    });

    await action.execute(
      { url: "https://cdn.invalid/label.jpg", schema: { type: "object" } },
      ctx(),
    );
  });

  it("infers PDFs from URL extensions and honors kind overrides", async () => {
    const action = getAction(makeShiftOcr(), "ocr.extract");
    const documents: unknown[] = [];

    mockShift((_input, init) => {
      documents.push(
        (JSON.parse(String(init?.body)) as { document: unknown }).document,
      );
      return { pagesProcessed: 1 };
    });

    await action.execute({ url: "https://cdn.invalid/scan.pdf" }, ctx());
    await action.execute(
      { url: "https://cdn.invalid/no-extension", kind: "document" },
      ctx(),
    );
    await action.execute(
      { url: "data:application/pdf;base64,JVBERi0=" },
      ctx(),
    );
    await action.execute({ url: "data:image/png;base64,iVBORw0=" }, ctx());
    assert.deepEqual(documents, [
      { type: "document", url: "https://cdn.invalid/scan.pdf" },
      { type: "document", url: "https://cdn.invalid/no-extension" },
      { type: "document", url: "data:application/pdf;base64,JVBERi0=" },
      { type: "image", url: "data:image/png;base64,iVBORw0=" },
    ]);
  });

  it("rejects invalid extract calls before any network call", async () => {
    const action = getAction(makeShiftOcr(), "ocr.extract");
    const directory = await mkdtemp(join(tmpdir(), "shift-ocr-plugin-"));
    const empty = join(directory, "empty.png");
    const oversized = join(directory, "oversized.png");
    await writeFile(empty, "");
    await writeFile(oversized, "x");
    await truncate(oversized, 20 * 1024 * 1024 + 1);
    const fetchCalls = refusingFetch();

    await assert.rejects(
      () => action.execute({}, ctx()),
      /exactly one of path or url/,
    );
    await assert.rejects(
      () =>
        action.execute(
          { path: "/tmp/a.jpg", url: "https://cdn.invalid/a.jpg" },
          ctx(),
        ),
      /exactly one of path or url/,
    );
    await assert.rejects(
      () =>
        action.execute(
          { url: "https://cdn.invalid/a.jpg", prompt: "Extract fields" },
          ctx(),
        ),
      /prompt requires schema/,
    );
    await assert.rejects(
      () => action.execute({ path: "/tmp/notes.docx" }, ctx()),
      /Unsupported file extension/,
    );
    await assert.rejects(
      () => action.execute({ path: empty }, ctx()),
      /File is empty/,
    );
    await assert.rejects(
      () => action.execute({ path: oversized }, ctx()),
      /capped at/,
    );
    assert.equal(fetchCalls(), 0);
  });

  it("lists OCR providers", async () => {
    const action = getAction(makeShiftOcr(), "ocr.providers");

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://cloud.shift-labs.ai/v1/services/ocr/providers",
      );
      assert.equal(init?.method, undefined);
      return {
        providers: [{ id: "mistral-ocr", defaultModel: "mistral-ocr-latest" }],
      };
    });

    assert.deepEqual(await action.execute({}, ctx()), [
      { id: "mistral-ocr", defaultModel: "mistral-ocr-latest" },
    ]);
  });
});
