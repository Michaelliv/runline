import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import {
  extForMime,
  writeImageFile,
  writeMediaFile,
} from "../../../runline-plugins/_shared/mediaFile.js";

const dir = mkdtempSync(join(tmpdir(), "media-writer-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

describe("shared media writer", () => {
  it("never overwrites another result with the same provider, timestamp, and index", () => {
    const options = { provider: "fal", stamp: 1, index: 0, saveDir: dir };
    const first = writeMediaFile({ ...options, bytes: Buffer.from("first") });
    const second = writeMediaFile({ ...options, bytes: Buffer.from("second") });
    assert.notEqual(first.path, second.path);
    assert.equal(readFileSync(first.path, "utf8"), "first");
    assert.equal(readFileSync(second.path, "utf8"), "second");
    assert.equal(dirname(first.path), dir);
    if (process.platform !== "win32")
      assert.equal(statSync(first.path).mode & 0o777, 0o600);
  });

  it("uses the same writer for base64 image output", () => {
    const out = writeImageFile({
      base64: Buffer.from("image").toString("base64"),
      provider: "openai-image",
      index: 0,
      saveDir: dir,
    });
    assert.equal(readFileSync(out.path, "utf8"), "image");
    assert.equal(out.byteLength, 5);
    assert.ok(out.path.endsWith(".png"));
  });

  it("maps MIME types without allowing paths or prototype keys into extensions", () => {
    for (const [mime, ext] of [
      ["image/jpeg", "jpg"],
      ["video/mp4", "mp4"],
      ["audio/mpeg", "mp3"],
      ["IMAGE/PNG; charset=binary", "png"],
      ["x/../../evil", "bin"],
      ["constructor", "bin"],
    ]) {
      assert.equal(extForMime(mime), ext);
    }
    assert.throws(
      () =>
        writeMediaFile({
          provider: "../escape",
          index: 0,
          bytes: new Uint8Array(),
          saveDir: dir,
        }),
      /invalid media provider/,
    );
  });
});
