import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { putThroughGrant } from "../../../runline-plugins/_shared/shiftUpload.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const dir = mkdtempSync(join(tmpdir(), "shift-upload-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const file = join(dir, "clip.mp3");
const bytes = Buffer.from("ID3-audio-bytes");
writeFileSync(file, bytes);

const grant = {
  method: "PUT" as const,
  url: "https://uploads.example/signed",
  headers: { "x-amz-meta-id": "abc" },
  expiresAt: "2026-09-22T13:00:00.000Z",
};

describe("signed-grant upload", () => {
  it("PUTs the file bytes with the grant headers and a default content-type", async () => {
    let seen: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      seen = { url: String(input), init };
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    await putThroughGrant(grant, file, "audio/mpeg", bytes.byteLength);
    assert.equal(seen?.url, grant.url);
    assert.equal(seen?.init?.method, "PUT");
    const headers = new Headers(seen?.init?.headers);
    assert.equal(headers.get("x-amz-meta-id"), "abc");
    assert.equal(headers.get("content-type"), "audio/mpeg");
    const body = seen?.init?.body;
    assert.ok(body instanceof Blob);
    assert.deepEqual(Buffer.from(await body.arrayBuffer()), bytes);
  });

  it("keeps a content-type the grant already signs", async () => {
    let headers: Headers | undefined;
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      headers = new Headers(init?.headers);
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    await putThroughGrant(
      { ...grant, headers: { "content-type": "application/octet-stream" } },
      file,
      "audio/mpeg",
      bytes.byteLength,
    );
    assert.equal(headers?.get("content-type"), "application/octet-stream");
  });

  it("reports a rejected upload with its label and status", async () => {
    globalThis.fetch = (async () =>
      new Response(null, { status: 403 })) as typeof fetch;
    await assert.rejects(
      putThroughGrant(
        grant,
        file,
        "audio/mpeg",
        bytes.byteLength,
        "Media upload",
      ),
      /Media upload failed: HTTP 403/,
    );
  });
});
