import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import gmail, {
  encodeEmail,
} from "../../../runline-plugins/gmail/src/index.js";
import { Runline } from "../sdk.js";

const gmailActions = Runline.create({ plugins: [gmail] }).actions();

function schemaFor(action: string): TSchema {
  const schema = gmailActions.find(
    (entry) => entry.action === action,
  )?.inputSchema;
  assert.ok(schema, `missing input schema for gmail.${action}`);
  return schema as TSchema;
}

function accepts(action: string, input: unknown): boolean {
  return Check(schemaFor(action), input);
}

function incompatibleValue(schema: TSchema): unknown {
  const metadata = schema as TSchema & { type?: string; anyOf?: TSchema[] };
  if (metadata.anyOf) return null;
  switch (metadata.type) {
    case "string":
      return 42;
    case "number":
    case "integer":
      return "not-a-number";
    case "boolean":
      return "not-a-boolean";
    case "array":
      return {};
    case "object":
      return [];
    default:
      return Symbol("invalid");
  }
}

const gmailValidInputs: Record<string, Record<string, unknown>> = {
  "message.send": { to: "to@example.com", subject: "Subject", text: "Body" },
  "message.reply": { messageId: "message", text: "Body" },
  "message.get": { id: "message" },
  "message.list": {},
  "message.delete": { id: "message" },
  "message.trash": { id: "message" },
  "message.untrash": { id: "message" },
  "message.markAsRead": { id: "message" },
  "message.markAsUnread": { id: "message" },
  "message.addLabels": { id: "message", labelIds: ["STARRED"] },
  "message.removeLabels": { id: "message", labelIds: ["STARRED"] },
  "message.getAttachment": { messageId: "message", attachmentId: "attachment" },
  "thread.get": { id: "thread" },
  "thread.list": {},
  "thread.delete": { id: "thread" },
  "thread.trash": { id: "thread" },
  "thread.untrash": { id: "thread" },
  "thread.addLabels": { id: "thread", labelIds: ["STARRED"] },
  "thread.removeLabels": { id: "thread", labelIds: ["STARRED"] },
  "thread.reply": { id: "thread", text: "Body" },
  "draft.create": {},
  "draft.get": { id: "draft" },
  "draft.list": {},
  "draft.delete": { id: "draft" },
  "draft.send": { id: "draft" },
  "label.create": { name: "Label" },
  "label.get": { id: "label" },
  "label.list": {},
  "label.delete": { id: "label" },
  "label.update": { id: "label", name: "Renamed" },
  "profile.get": {},
  "alias.list": {},
};

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

describe("gmail plugin TypeBox schemas", () => {
  it("covers the complete 32-action surface with strict object schemas", () => {
    assert.deepEqual(
      gmailActions.map((entry) => entry.action),
      [
        "message.send",
        "message.reply",
        "message.get",
        "message.list",
        "message.delete",
        "message.trash",
        "message.untrash",
        "message.markAsRead",
        "message.markAsUnread",
        "message.addLabels",
        "message.removeLabels",
        "message.getAttachment",
        "thread.get",
        "thread.list",
        "thread.delete",
        "thread.trash",
        "thread.untrash",
        "thread.addLabels",
        "thread.removeLabels",
        "thread.reply",
        "draft.create",
        "draft.get",
        "draft.list",
        "draft.delete",
        "draft.send",
        "label.create",
        "label.get",
        "label.list",
        "label.delete",
        "label.update",
        "profile.get",
        "alias.list",
      ],
    );

    assert.deepEqual(
      gmailActions.map((entry) => entry.action),
      Object.keys(gmailValidInputs),
    );

    for (const action of gmailActions) {
      const schema = action.inputSchema as TSchema & {
        type?: string;
        additionalProperties?: boolean;
        properties?: Record<string, TSchema>;
        required?: string[];
      };
      const fixture = gmailValidInputs[action.action];
      assert.equal(schema.type, "object", `${action.action} must be an object`);
      assert.equal(
        schema.additionalProperties,
        false,
        `${action.action} must reject unknown fields`,
      );
      assert.equal(
        accepts(action.action, fixture),
        true,
        `${action.action} fixture must be valid`,
      );
      assert.equal(
        accepts(action.action, { ...fixture, unexpected: true }),
        false,
        `${action.action} accepted an unknown field`,
      );
      for (const required of schema.required ?? []) {
        const missing = { ...fixture };
        delete missing[required];
        assert.equal(
          accepts(action.action, missing),
          false,
          `${action.action} must require ${required}`,
        );
      }
      for (const [property, propertySchema] of Object.entries(
        schema.properties ?? {},
      )) {
        assert.equal(
          accepts(action.action, {
            ...fixture,
            [property]: incompatibleValue(propertySchema),
          }),
          false,
          `${action.action}.${property} must reject incompatible values`,
        );
      }
    }
  });

  it("accepts text, jsx, and attachment-only messages", () => {
    assert.equal(
      accepts("message.send", {
        to: "recipient@example.com",
        subject: "Text",
        text: "hello",
      }),
      true,
    );
    assert.equal(
      accepts("message.send", {
        to: "recipient@example.com",
        subject: "JSX",
        jsx: "<Html />",
      }),
      true,
    );
    assert.equal(
      accepts("message.send", {
        to: "recipient@example.com",
        subject: "Attachment",
        attachments: [
          {
            filename: "empty.txt",
            mimeType: "text/plain",
            contentBase64: "",
          },
        ],
      }),
      true,
    );
    assert.equal(
      accepts("message.send", {
        to: "recipient@example.com",
        subject: "Drive attachment",
        attachments: [
          {
            name: "drive.txt",
            contentBase64: { contentBase64: "aGVsbG8=" },
          },
        ],
      }),
      true,
    );
  });

  it("rejects missing content and common misnamed body fields", () => {
    const base = { to: "recipient@example.com", subject: "Missing" };
    assert.equal(accepts("message.send", base), false);
    assert.equal(accepts("message.send", { ...base, body: "hello" }), false);
    assert.equal(accepts("message.send", { ...base, message: "hello" }), false);
    assert.equal(accepts("message.send", { ...base, content: "hello" }), false);
    assert.equal(accepts("message.send", { ...base, text: "" }), false);
    assert.equal(accepts("message.send", { ...base, text: "   " }), false);
    // html was removed in favor of jsx; the strict schema rejects it.
    assert.equal(accepts("message.send", { ...base, html: "<p>x</p>" }), false);
    assert.equal(accepts("message.send", { ...base, attachments: [] }), false);
  });

  it("validates attachment arrays and nested Drive-shaped content", () => {
    const base = { to: "recipient@example.com", subject: "Bad attachment" };
    assert.equal(
      accepts("message.send", { ...base, attachments: ["not-an-object"] }),
      false,
    );
    assert.equal(
      accepts("message.send", { ...base, attachments: [{}] }),
      false,
    );
    assert.equal(
      accepts("message.send", {
        ...base,
        attachments: [{ contentBase64: 123 }],
      }),
      false,
    );
    assert.equal(
      accepts("message.send", {
        ...base,
        attachments: [{ contentBase64: { contentBase64: 123 } }],
      }),
      false,
    );
    assert.equal(
      accepts("message.send", {
        ...base,
        attachments: [
          { contentBase64: { contentBase64: "aA==", unexpected: true } },
        ],
      }),
      false,
    );
    assert.equal(
      accepts("message.send", {
        ...base,
        attachments: [{ contentBase64: "aA==", unexpected: true }],
      }),
      false,
    );
  });

  it("applies the same content contract to message and thread replies", () => {
    for (const [action, idField] of [
      ["message.reply", "messageId"],
      ["thread.reply", "id"],
    ] as const) {
      const base = { [idField]: "id-1" };
      assert.equal(accepts(action, { ...base, text: "reply" }), true);
      assert.equal(accepts(action, { ...base, jsx: "<Html />" }), true);
      assert.equal(
        accepts(action, {
          ...base,
          attachments: [{ contentBase64: "aA==" }],
        }),
        true,
      );
      assert.equal(accepts(action, base), false);
      assert.equal(accepts(action, { ...base, body: "reply" }), false);
      assert.equal(
        accepts(action, {
          ...base,
          text: "reply",
          replyToSenderOnly: true,
          replyToRecipientsOnly: true,
        }),
        false,
      );
    }
  });

  it("keeps empty drafts valid while typing draft attachments", () => {
    assert.equal(accepts("draft.create", {}), true);
    assert.equal(
      accepts("draft.create", {
        attachments: [{ contentBase64: { contentBase64: "aA==" } }],
      }),
      true,
    );
    assert.equal(
      accepts("draft.create", {
        attachments: [{ contentBase64: { contentBase64: false } }],
      }),
      false,
    );
  });

  it("accepts string and numeric timestamps and enforces closed enums", () => {
    assert.equal(
      accepts("message.list", {
        receivedAfter: "2026-07-01T00:00:00Z",
        receivedBefore: 1_788_220_800_000,
        readStatus: "both",
      }),
      true,
    );
    assert.equal(accepts("message.list", { receivedAfter: true }), false);
    assert.equal(accepts("message.list", { readStatus: "maybe" }), false);
    assert.equal(accepts("message.get", { id: "m", format: "raw" }), true);
    assert.equal(accepts("message.get", { id: "m", format: "invalid" }), false);
    assert.equal(accepts("thread.get", { id: "t", format: "raw" }), false);
    assert.equal(
      accepts("label.create", {
        name: "Important",
        labelListVisibility: "labelShowIfUnread",
        messageListVisibility: "show",
      }),
      true,
    );
    assert.equal(
      accepts("label.create", {
        name: "Important",
        labelListVisibility: "sometimes",
      }),
      false,
    );
  });

  it("uses integers and bounds for pagination and non-empty label arrays", () => {
    assert.equal(accepts("message.list", { maxResults: 1 }), true);
    assert.equal(accepts("message.list", { maxResults: 500 }), true);
    assert.equal(accepts("message.list", { maxResults: 0 }), false);
    assert.equal(accepts("message.list", { maxResults: 1.5 }), false);
    assert.equal(accepts("message.list", { maxResults: 501 }), false);
    assert.equal(
      accepts("message.addLabels", { id: "m", labelIds: ["STARRED"] }),
      true,
    );
    assert.equal(
      accepts("message.addLabels", { id: "m", labelIds: [] }),
      false,
    );
    assert.equal(
      accepts("message.addLabels", { id: "m", labelIds: [123] }),
      false,
    );
  });

  it("requires empty objects for no-input actions", () => {
    for (const action of ["label.list", "profile.get", "alias.list"]) {
      assert.equal(accepts(action, {}), true);
      assert.equal(accepts(action, undefined), false);
      assert.equal(accepts(action, { unexpected: true }), false);
    }
  });

  it("rejects SHFT-545 inputs in the execution engine before fetching", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("fetch should not run");
    }) as typeof fetch;

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
          subject: "Lost body",
          body: "This must not be silently discarded",
        });
      `);

      assert.equal(result.result, null);
      assert.match(
        result.error ?? "",
        /Invalid input for gmail\.message\.send/,
      );
      assert.match(result.error ?? "", /additional properties/);
      assert.equal(fetchCalls, 0);
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
