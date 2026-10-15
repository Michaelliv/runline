import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { standardBase64 } from "../../../runline-plugins/_shared/base64.js";
import { responseFailed } from "../../../runline-plugins/_shared/credentials.js";
import { readLocalFile } from "../../../runline-plugins/_shared/localFile.js";
import { readImageInput } from "../../../runline-plugins/_shared/mediaFile.js";
import googleDrive from "../../../runline-plugins/googleDrive/src/index.js";
import microsoftFiles from "../../../runline-plugins/microsoftFiles/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, RunlinePluginAPI } from "../plugin/types.js";

const dir = mkdtempSync(join(tmpdir(), "plugin-input-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const options = {
  subject: "example: contentPath",
  maxBytes: 8,
  oversize: "example: too big",
};

describe("standardBase64", () => {
  it("normalizes whitespace, base64url and padding", () => {
    for (const [input, expected] of [
      ["", ""],
      ["aGk=", "aGk="],
      ["aGk", "aGk="],
      ["YWJjZA", "YWJjZA=="],
      [" YW\r\nJj ZA== ", "YWJjZA=="],
      ["-_-_", "+/+/"],
      [Buffer.from([251, 255]).toString("base64url"), "+/8="],
    ])
      assert.equal(standardBase64(input), expected, input);
  });
  it("refuses what no encoder produces", () => {
    for (const input of ["a", "a===", "abcde", "!!!", "aGk=aGk=", "a=b="])
      assert.equal(standardBase64(input), undefined, input);
  });
  it("handles multi-megabyte values with flat patterns", () => {
    assert.equal(standardBase64("A".repeat(6_000_000))?.length, 6_000_000);
  });
});

describe("caller-supplied base64 in upload actions", () => {
  const actionOf = (
    name: string,
    register: (rl: RunlinePluginAPI) => void,
    path: string,
  ) => {
    const { api, resolve } = createPluginAPI(name);
    register(api);
    const found = resolve().actions.find((a) => a.name === path);
    assert.ok(found, path);
    return found;
  };
  const ctx = {
    connection: { name: "t", plugin: "t", config: {} },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  } as unknown as ActionContext;
  it("refuses invalid base64 before any request instead of uploading corrupt bytes", async () => {
    const originalFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched++;
      return Response.json({});
    }) as typeof fetch;
    try {
      await assert.rejects(
        () =>
          actionOf("googleDrive", googleDrive, "file.upload").execute(
            { name: "a.txt", contentBase64: "not base64!" },
            ctx,
          ),
        { message: "googleDrive: contentBase64 is not valid base64" },
      );
      await assert.rejects(
        () =>
          actionOf("microsoftFiles", microsoftFiles, "files.upload").execute(
            { path: "a.txt", base64: "a===" },
            ctx,
          ),
        { message: "microsoftFiles: base64 is not valid base64" },
      );
      assert.equal(fetched, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("readLocalFile", () => {
  it("reads a regular file within the bound, empty included", async () => {
    const file = join(dir, "ok.txt");
    writeFileSync(file, "12345678");
    assert.equal((await readLocalFile(file, options)).toString(), "12345678");
    const empty = join(dir, "empty.txt");
    writeFileSync(empty, "");
    assert.equal((await readLocalFile(empty, options)).length, 0);
  });
  it("refuses missing, non-regular and oversized files by the caller's names", async () => {
    const big = join(dir, "big.bin");
    writeFileSync(big, "");
    truncateSync(big, 9);
    const sub = join(dir, "sub");
    mkdirSync(sub);
    for (const [path, message] of [
      [join(dir, "missing"), "example: contentPath is unreadable (ENOENT)"],
      [sub, "example: contentPath must be a regular file"],
      [big, "example: too big"],
    ])
      await assert.rejects(() => readLocalFile(path, options), { message });
  });
  it("refuses a FIFO without waiting for a writer", {
    skip: process.platform === "win32",
  }, async () => {
    const fifo = join(dir, "fifo");
    execFileSync("mkfifo", [fifo]);
    await assert.rejects(() => readLocalFile(fifo, options), {
      message: "example: contentPath must be a regular file",
    });
    await assert.rejects(() => readImageInput(fifo, "fal"), {
      message: "fal: imagePath must be a regular file",
    });
  });
});

describe("readImageInput", () => {
  it("loads an image as bytes, base64 and a data URI", async () => {
    const file = join(dir, "pixel.png");
    writeFileSync(file, Buffer.from("png"));
    const image = await readImageInput(file, "fal");
    assert.equal(image.mimeType, "image/png");
    assert.equal(image.dataUri, `data:image/png;base64,${image.base64}`);
    assert.equal(image.fileName, "pixel.png");
  });
  it("bounds the read at 50 MiB", async () => {
    const big = join(dir, "huge.png");
    writeFileSync(big, "");
    truncateSync(big, 50 * 1024 * 1024 + 1);
    await assert.rejects(() => readImageInput(big, "xai"), {
      message: "xai: imagePath exceeds 50 MiB",
    });
  });
});

describe("responseFailed", () => {
  const failed = (body: BodyInit | null, status = 422) =>
    new Response(body, { status });
  it("keeps only identifier-shaped codes and params from the envelope", async () => {
    const error = await responseFailed(
      "example",
      failed(
        JSON.stringify({
          code: "invalid_field",
          param: ["body.text", "bad param with spaces", 3],
          message: "secret-token echoed",
        }),
      ),
      (body) => body as { code?: unknown; param?: unknown },
    );
    assert.equal(
      error.message,
      "example: request failed (HTTP 422 invalid_field, param: body.text, 3)",
    );
    assert.equal(error.status, 422);
    assert.ok(!error.message.includes("secret-token"));
  });
  it("reports the status alone for non-JSON bodies, free-text codes and throwing readers", async () => {
    for (const [body, read] of [
      ["plain text secret-token", () => ({ code: "never" })],
      [JSON.stringify({ code: "has spaces" }), (b: unknown) => b as object],
      [
        JSON.stringify({}),
        () => {
          throw new Error("reader bug");
        },
      ],
    ] as const)
      assert.equal(
        (await responseFailed("example", failed(body, 500), read)).message,
        "example: request failed (HTTP 500)",
      );
  });
});
