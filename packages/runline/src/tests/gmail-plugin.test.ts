import assert from "node:assert/strict";
import { describe, it } from "node:test";
import gmail, {
  encodeEmail,
} from "../../../runline-plugins/gmail/src/index.js";
import { Runline } from "../sdk.js";

describe("gmail plugin send errors", () => {
  it("nudges agents to check sent mail with Gmail actions before retrying", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 429,
            message:
              "Too many requests: User-rate limit exceeded (Mail sending)",
            errors: [{ reason: "userRateLimitExceeded" }],
          },
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    try {
      const rl = Runline.create({
        plugins: [gmail],
        connections: [
          {
            name: "test",
            plugin: "gmail",
            config: {
              accessToken: "token",
              accessTokenExpiresAt: Date.now() + 60 * 60 * 1000,
            },
          },
        ],
      });
      const result = await rl.execute(`
        return await gmail.message.send({
          to: "recipient@example.com",
          subject: "test",
          text: "hello",
        });
      `);

      assert.equal(result.result, null);
      assert.match(result.error ?? "", /gmail\.message\.list/);
      assert.match(result.error ?? "", /in:sent/);
      assert.match(result.error ?? "", /gmail\.message\.get/);
      assert.match(result.error ?? "", /before retrying/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("gmail plugin MIME encoding", () => {
  it("does not line-wrap large attachment base64 with String.prototype.match", () => {
    const originalMatch = String.prototype.match;
    let sawAttachmentFoldMatch = false;

    String.prototype.match = function patchedMatch(
      this: string,
      regexp: string | RegExp,
    ) {
      if (
        this.length > 4 * 1024 * 1024 &&
        regexp instanceof RegExp &&
        regexp.source === ".{1,76}" &&
        regexp.global
      ) {
        sawAttachmentFoldMatch = true;
      }
      return originalMatch.call(this, regexp as RegExp);
    } as typeof String.prototype.match;

    try {
      const contentBase64 = Buffer.alloc(4_700_000, 0x61).toString("base64");
      const raw = encodeEmail({
        to: "recipient@example.com",
        subject: "large attachment",
        text: "see attached",
        attachments: [
          {
            name: "large.docx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            contentBase64,
          },
        ],
      });

      assert.equal(typeof raw, "string");
      assert.equal(
        sawAttachmentFoldMatch,
        false,
        "large attachment folding must not materialize a global regex match array",
      );
    } finally {
      String.prototype.match = originalMatch;
    }
  });

  it("accepts Drive download-shaped attachment content", () => {
    const raw = encodeEmail({
      to: "recipient@example.com",
      subject: "drive attachment",
      text: "see attached",
      attachments: [
        {
          filename: "drive.txt",
          mimeType: "text/plain",
          contentBase64: {
            contentBase64: Buffer.from("hello").toString("base64"),
          },
        },
      ],
    });

    assert.equal(typeof raw, "string");
    assert.ok(raw.length > 0);
  });

  it("normalizes base64url attachment content into MIME-safe base64", () => {
    const bytes = Buffer.from([251, 255, 254, 250, 239, 190]);
    const raw = encodeEmail({
      to: "recipient@example.com",
      subject: "gmail attachment",
      text: "see attached",
      attachments: [
        {
          name: "gmail.bin",
          mimeType: "application/octet-stream",
          contentBase64: bytes.toString("base64url"),
        },
      ],
    });

    const message = Buffer.from(raw, "base64url").toString("utf8");
    assert.match(message, /Content-Transfer-Encoding: base64/);
    assert.match(message, /\+\/\/\+\+u\+\+/);
    assert.doesNotMatch(message, /-__-/);
  });

  it("throws a clear error for invalid attachment base64 characters", () => {
    assert.throws(
      () =>
        encodeEmail({
          to: "recipient@example.com",
          subject: "bad attachment",
          attachments: [
            {
              name: "bad.txt",
              mimeType: "text/plain",
              contentBase64: "not base64!",
            },
          ],
        }),
      /gmail: attachment 0 contentBase64 contains invalid base64 characters/,
    );
  });

  it("throws a clear error for invalid attachment content", () => {
    assert.throws(
      () =>
        encodeEmail({
          to: "recipient@example.com",
          subject: "bad attachment",
          attachments: [
            {
              name: "bad.txt",
              mimeType: "text/plain",
              contentBase64: { contentBase64: 123 },
            },
          ],
        }),
      /gmail: attachment 0 contentBase64 must be a base64 string/,
    );
  });

  it("rejects oversized attachments before MIME assembly", () => {
    assert.throws(
      () =>
        encodeEmail({
          to: "recipient@example.com",
          subject: "too large",
          attachments: [
            {
              name: "too-large.bin",
              mimeType: "application/octet-stream",
              contentBase64: "a".repeat(36 * 1024 * 1024),
            },
          ],
        }),
      /gmail: attachment payload is \d+ bytes after MIME folding; Gmail API raw messages must be <= \d+ bytes/,
    );
  });
});
