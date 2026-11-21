import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  DOWNLOAD_RANGE_BYTES,
  type DownloadSource,
  rangedDownload,
} from "../credentials/download.js";
import { credentialRequest, staticCredential } from "../credentials/plugin.js";
import type { ActionContext } from "../plugin/types.js";
import { rangeResponse, stubFetch } from "./helpers/plugin.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const MiB = 1024 * 1024;
/** Two full ranges and a short third. */
const content = randomBytes(2 * DOWNLOAD_RANGE_BYTES + 3);
const md5 = (bytes: Uint8Array) =>
  createHash("md5").update(bytes).digest("hex");
const inMemory = { maxBytes: content.byteLength, oversize: "too large" };

/** A source answering from `respond`, recording the ranges it was asked for. */
function source(respond: (range: string, asked: number) => Response) {
  const ranges: string[] = [];
  const from: DownloadSource = {
    plugin: "test",
    async request(range) {
      ranges.push(range);
      return respond(range, ranges.length);
    },
    failed: (response) => new Error(`failed ${response.status}`),
  };
  return { from, ranges };
}
const serving = (bytes: Uint8Array) =>
  source((range) => rangeResponse(bytes, range));
function target() {
  const dir = mkdtempSync(join(tmpdir(), "ranged-"));
  return { dir, savePath: join(dir, "out.bin") };
}

describe("rangedDownload", () => {
  it("writes content larger than one range, asked for in order", async () => {
    const { from, ranges } = serving(content);
    const { dir, savePath } = target();
    const result = await rangedDownload(
      from,
      { savePath },
      { md5: md5(content).toUpperCase() },
    );
    assert.deepEqual(ranges, [
      `bytes=0-${8 * MiB - 1}`,
      `bytes=${8 * MiB}-${16 * MiB - 1}`,
      `bytes=${16 * MiB}-${24 * MiB - 1}`,
    ]);
    assert.equal(result.size, content.byteLength);
    assert.ok(readFileSync(savePath).equals(content));
    assert.deepEqual(readdirSync(dir), ["out.bin"]);
  });

  it("answers the bytes when there is no file to write", async () => {
    const result = await rangedDownload(serving(content).from, inMemory);
    assert.ok(result.bytes.equals(content));
    assert.equal(result.size, content.byteLength);
  });

  it("refuses content larger than memory may hold after one range", async () => {
    const { from, ranges } = serving(content);
    await assert.rejects(
      rangedDownload(from, {
        maxBytes: content.byteLength - 1,
        oversize: "too large; pass savePath",
      }),
      { message: "too large; pass savePath" },
    );
    assert.equal(ranges.length, 1);
  });

  it("takes the whole content from a server that ignores Range", async () => {
    const { from, ranges } = source(
      () => new Response("whole", { headers: { "content-type": "text/x" } }),
    );
    const { savePath } = target();
    const result = await rangedDownload(from, { savePath });
    assert.equal(readFileSync(savePath, "utf8"), "whole");
    assert.equal(result.headers.get("content-type"), "text/x");
    assert.equal(ranges.length, 1);
  });

  it("writes an empty file for empty content", async () => {
    const { savePath } = target();
    const result = await rangedDownload(serving(new Uint8Array()).from, {
      savePath,
    });
    assert.equal(result.size, 0);
    assert.equal(readFileSync(savePath).byteLength, 0);
  });

  it("ends at a 416 when the total was never stated", async () => {
    const exact = content.subarray(0, DOWNLOAD_RANGE_BYTES);
    const { from, ranges } = source((range) => {
      const answer = rangeResponse(exact, range);
      if (answer.status !== 206) return answer;
      const headers = new Headers(answer.headers);
      headers.set(
        "content-range",
        String(headers.get("content-range")).replace(/\/\d+$/, "/*"),
      );
      return new Response(answer.body, { status: 206, headers });
    });
    const result = await rangedDownload(from, inMemory);
    assert.ok(result.bytes.equals(exact));
    assert.equal(ranges.length, 2);
  });

  it("leaves nothing behind when the content changes between ranges", async () => {
    const { from } = source((range, asked) =>
      rangeResponse(asked === 1 ? content : content.subarray(1), range),
    );
    const { dir, savePath } = target();
    await assert.rejects(rangedDownload(from, { savePath }), {
      message: "test: the content changed while downloading",
    });
    assert.deepEqual(readdirSync(dir), []);
  });

  it("leaves nothing behind when the bytes do not match the checksum", async () => {
    const { dir, savePath } = target();
    await assert.rejects(
      rangedDownload(
        serving(content).from,
        { savePath },
        { md5: md5(Buffer.from("other")) },
      ),
      { message: "test: the download does not match the content's checksum" },
    );
    assert.deepEqual(readdirSync(dir), []);
  });

  it("asks again for a range the server could not serve yet", async () => {
    const { from, ranges } = source((range, asked) =>
      asked === 2
        ? new Response(null, { status: 503 })
        : rangeResponse(content, range),
    );
    const result = await rangedDownload(from, inMemory);
    assert.ok(result.bytes.equals(content));
    assert.equal(ranges[1], ranges[2]);
    assert.equal(ranges.length, 4);
  });

  it("reports an answer that is not the content, without asking again", async () => {
    const { from, ranges } = source(() => new Response(null, { status: 404 }));
    await assert.rejects(rangedDownload(from, inMemory), {
      message: "failed 404",
    });
    assert.equal(ranges.length, 1);
  });

  it("refuses a range other than the one it asked for", async () => {
    const { from } = source(
      () =>
        new Response("abc", {
          status: 206,
          headers: { "content-range": "bytes 5-7/100" },
        }),
    );
    await assert.rejects(rangedDownload(from, inMemory), {
      code: "invalid_response",
    });
  });

  it("signs every range and asks for the content uncoded", async () => {
    const credential = staticCredential({
      id: "files",
      auth: { kind: "bearer" },
      local: { secret: "token" },
      targets: {
        api: {
          baseUrl: "https://files.example/v1/",
          methods: ["GET"],
          allowedHeaders: ["Range"],
        },
      },
    });
    const ctx: ActionContext = {
      connection: { name: "c", plugin: "files", config: { token: "t" } },
      log: { info() {}, warn() {}, error() {} },
      async updateConnection() {},
    };
    const seen: Headers[] = [];
    stubFetch(async (_url, init) => {
      const headers = new Headers(init?.headers);
      seen.push(headers);
      return rangeResponse(content, headers.get("range"));
    });
    const result = await rangedDownload(
      {
        plugin: "files",
        request: (range) =>
          credentialRequest(ctx, credential, {
            target: "api",
            path: "files/1/content",
            headers: { Range: range },
          }),
        failed: (response) => new Error(String(response.status)),
      },
      inMemory,
    );
    assert.ok(result.bytes.equals(content));
    assert.equal(seen.length, 3);
    for (const headers of seen) {
      assert.equal(headers.get("authorization"), "Bearer t");
      assert.equal(headers.get("accept-encoding"), "identity");
    }
  });
});
