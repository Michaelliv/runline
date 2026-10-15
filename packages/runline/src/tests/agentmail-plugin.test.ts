import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import { agentMailCredential } from "../../../runline-plugins/agentMail/src/credentials.js";
import agentMail from "../../../runline-plugins/agentMail/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import { helpInputs, validateTypedInput } from "../plugin/schema.js";
import type { ActionContext, TypedInputSchema } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const dir = mkdtempSync(join(tmpdir(), "agentmail-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const { api, resolve } = createPluginAPI("agentMail");
agentMail(api);
const plugin = resolve();
const ctx: ActionContext = {
  connection: {
    name: "mail",
    plugin: "agentMail",
    config: { apiKey: "test-key" },
  },
  log: { info() {}, warn() {}, error() {} },
  async updateConnection() {},
};
function action(name: string) {
  const found = plugin.actions.find((a) => a.name === name);
  assert.ok(found, name);
  return found;
}
async function run(name: string, input: unknown = {}, context = ctx) {
  return action(name).execute(input, context);
}
/** The engine's verdict on an input, normalization included. */
function valid(name: string, input: unknown) {
  return validateTypedInput(action(name).inputSchema as TypedInputSchema, input)
    .ok;
}
function mock(response: unknown = {}) {
  const calls: { url: URL; init: RequestInit; body: unknown }[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: new URL(String(url)),
      init: init ?? {},
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return response instanceof Response ? response : Response.json(response);
  }) as typeof fetch;
  return calls;
}
const header = (init: RequestInit, name: string) =>
  new Headers(init.headers).get(name);
const inboxId = "agent@example.com";
const inbox = { inboxId };
const message = { ...inbox, messageId: "<m@example.com>" };
const thread = { ...inbox, threadId: "t1" };
const draft = { ...inbox, draftId: "d1" };
const ip = "inboxes/agent%40example.com";
const mp = `${ip}/messages/%3Cm%40example.com%3E`;
const tp = `${ip}/threads/t1`;
const dp = `${ip}/drafts/d1`;
const receipt = { message_id: "m1", thread_id: "t1" };
const sends = [
  "message.send",
  "message.reply",
  "message.replyAll",
  "message.forward",
  "draft.send",
];
const attachmentWrites = [
  ["message.send", "attachments"],
  ["message.reply", "attachments"],
  ["message.replyAll", "attachments"],
  ["message.forward", "attachments"],
  ["draft.create", "attachments"],
  ["draft.update", "addAttachments"],
] as const;
const wireKey = (key: string) =>
  key === "addAttachments" ? "add_attachments" : key;
// Each action's route, method, wire body and access are independently enumerated.
const routes: Array<
  [string, Record<string, unknown>, string, string, unknown?, "read"?]
> = [
  ["whoami", {}, "GET", "auth/me"],
  ["inbox.list", {}, "GET", "inboxes"],
  ["inbox.search", { query: "sup" }, "GET", "inboxes/search"],
  ["inbox.get", inbox, "GET", ip],
  [
    "inbox.create",
    {
      displayName: "Agent",
      clientId: "stable",
      status: "active",
      metadata: { userName: "me" },
    },
    "POST",
    "inboxes",
    {
      display_name: "Agent",
      client_id: "stable",
      status: "active",
      metadata: { userName: "me" },
    },
  ],
  [
    "inbox.update",
    { ...inbox, metadata: null },
    "PATCH",
    ip,
    { metadata: null },
  ],
  ["inbox.delete", inbox, "DELETE", ip],
  ["message.list", inbox, "GET", `${ip}/messages`],
  [
    "message.search",
    { ...inbox, query: "hello" },
    "GET",
    `${ip}/messages/search`,
  ],
  ["message.get", message, "GET", mp],
  [
    "message.attachment",
    { ...message, attachmentId: "a1" },
    "GET",
    `${mp}/attachments/a1`,
  ],
  [
    "message.update",
    { ...message, addLabels: ["read"] },
    "PATCH",
    mp,
    { add_labels: ["read"] },
  ],
  ["message.delete", message, "DELETE", mp],
  [
    "message.batchGet",
    { ...inbox, messageIds: ["m1"] },
    "POST",
    `${ip}/messages/batch-get`,
    { message_ids: ["m1"] },
    "read",
  ],
  [
    "message.batchUpdate",
    { ...inbox, messageIds: ["m1"], removeLabels: ["unread"] },
    "POST",
    `${ip}/messages/batch-update`,
    { message_ids: ["m1"], remove_labels: ["unread"] },
  ],
  [
    "message.send",
    { ...inbox, to: "a@example.com", text: "Hello" },
    "POST",
    `${ip}/messages/send`,
    { to: "a@example.com", text: "Hello" },
  ],
  [
    "message.reply",
    { ...message, text: "Reply", replyTo: "r@example.com" },
    "POST",
    `${mp}/reply`,
    { text: "Reply", reply_to: "r@example.com" },
  ],
  [
    "message.replyAll",
    { ...message, text: "Reply all" },
    "POST",
    `${mp}/reply-all`,
    { text: "Reply all" },
  ],
  [
    "message.forward",
    { ...message, bcc: ["a@example.com"] },
    "POST",
    `${mp}/forward`,
    { bcc: ["a@example.com"] },
  ],
  ["thread.list", inbox, "GET", `${ip}/threads`],
  [
    "thread.search",
    { ...inbox, query: "hello" },
    "GET",
    `${ip}/threads/search`,
  ],
  ["thread.get", thread, "GET", tp],
  [
    "thread.update",
    { ...thread, removeLabels: ["triage"] },
    "PATCH",
    tp,
    { remove_labels: ["triage"] },
  ],
  ["thread.delete", thread, "DELETE", tp],
  [
    "thread.attachment",
    { ...thread, attachmentId: "a1" },
    "GET",
    `${tp}/attachments/a1`,
  ],
  ["draft.list", inbox, "GET", `${ip}/drafts`],
  ["draft.get", draft, "GET", dp],
  ["draft.create", inbox, "POST", `${ip}/drafts`, {}],
  [
    "draft.update",
    { ...draft, to: [], text: null, sendAt: null },
    "PATCH",
    dp,
    { to: [], text: null, send_at: null },
  ],
  ["draft.delete", draft, "DELETE", dp],
  ["draft.send", draft, "POST", `${dp}/send`, {}],
  [
    "draft.attachment",
    { ...draft, attachmentId: "a1" },
    "GET",
    `${dp}/attachments/a1`,
  ],
];
const routeInput = (name: string) => {
  const entry = routes.find(([key]) => key === name);
  assert.ok(entry, name);
  return entry[1];
};

describe("agentMail", () => {
  it("registers the exact 32-action surface, strict schemas and a broker declaration", () => {
    assert.equal(routes.length, 32);
    assert.deepEqual(
      plugin.actions.map((a) => a.name).sort(),
      routes.map(([name]) => name).sort(),
    );
    assert.equal(plugin.credential?.({}).type.id, "agentMail");
    for (const [name, input, method, , , access] of routes) {
      assert.equal(
        action(name).access,
        access ?? (method === "GET" ? "read" : "write"),
        name,
      );
      assert.ok(valid(name, input), name);
      assert.equal(valid(name, { ...input, unknownField: true }), false, name);
    }
  });
  for (const [name, input, method, path, body] of routes) {
    it(`${name}: documented route, method and body`, async () => {
      const calls = mock(receipt);
      assert.deepEqual(await run(name, input), receipt);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url.origin, "https://api.agentmail.to");
      assert.equal(calls[0].url.pathname, `/v0/${path}`);
      assert.equal(calls[0].init.method, method);
      assert.deepEqual(calls[0].body, body);
      assert.equal(
        header(calls[0].init, "content-type"),
        body === undefined ? null : "application/json",
      );
      assert.equal(header(calls[0].init, "authorization"), "Bearer test-key");
      assert.equal(calls[0].init.redirect, "error");
      assert.ok(calls[0].init.signal);
    });
  }
  it("declares sends on their own target with the broker's idempotency contract", () => {
    const { type, method } = agentMailCredential({});
    const targets = type.methods[method].targets;
    assert.deepEqual(targets.send.idempotency, {
      header: "Idempotency-Key",
      methods: ["POST"],
    });
    assert.equal(targets.api.idempotency, undefined);
    assert.equal(targets.api.allowedHeaders, undefined);
    assert.equal(targets.send.baseUrl, targets.api.baseUrl);
  });
  it("selects the EU origin by region and refuses an unknown region before IO", async () => {
    const eu = {
      ...ctx,
      connection: { ...ctx.connection, config: { apiKey: "k", region: "eu" } },
    };
    let calls = mock(receipt);
    await run("message.send", { ...inbox, to: "a@example.com" }, eu);
    assert.equal(calls[0].url.origin, "https://api.agentmail.eu");
    assert.equal(calls[0].url.pathname, `/v0/${ip}/messages/send`);
    calls = mock();
    await run("whoami", {}, eu);
    assert.equal(calls[0].url.origin, "https://api.agentmail.eu");
    calls = mock();
    await assert.rejects(
      () =>
        run(
          "whoami",
          {},
          {
            ...ctx,
            connection: {
              ...ctx.connection,
              config: { apiKey: "k", region: "mars" },
            },
          },
        ),
      { code: "invalid_credentials" },
    );
    assert.equal(calls.length, 0);
  });
  it("preserves pagination, repeated filters, false values and search encoding", async () => {
    const response = { messages: [], next_page_token: "next+&", count: 0 };
    let calls = mock(response);
    assert.deepEqual(
      await run("message.list", {
        ...inbox,
        limit: 10,
        pageToken: "prev+&",
        labels: ["read", "triage"],
        from: ["Alice", "example.com"],
        to: ["Bob"],
        subject: ["A & B"],
        ascending: false,
        includeSpam: false,
        includeBlocked: true,
        includeUnauthenticated: false,
        includeTrash: true,
        before: "2026-09-01T00:00:00Z",
        after: "2026-08-01T00:00:00Z",
      }),
      response,
    );
    const q = calls[0].url.searchParams;
    assert.deepEqual(q.getAll("labels"), ["read", "triage"]);
    assert.deepEqual(q.getAll("from"), ["Alice", "example.com"]);
    assert.equal(q.get("page_token"), "prev+&");
    assert.equal(q.get("include_spam"), "false");
    assert.equal(q.get("include_unauthenticated"), "false");
    assert.equal(q.get("include_trash"), "true");
    assert.equal(q.get("inbox_id"), null);
    calls = mock({ threads: [], next_page_token: "next" });
    await run("thread.search", { ...inbox, query: "a+b & c", pageToken: "p" });
    assert.equal(calls[0].url.searchParams.get("q"), "a+b & c");
    assert.equal(calls[0].url.searchParams.has("query"), false);
    calls = mock({ inboxes: [], next_page_token: "n" });
    await run("inbox.search", { query: "sup", limit: 5, pageToken: "p" });
    assert.equal(calls[0].url.searchParams.get("q"), "sup");
    assert.equal(calls[0].url.searchParams.get("limit"), "5");
    assert.equal(calls[0].url.searchParams.get("page_token"), "p");
    calls = mock({ messages: [], next_page_token: "older" });
    await run("thread.get", { ...thread, limit: 2, pageToken: "older" });
    assert.equal(calls[0].url.searchParams.get("limit"), "2");
    assert.equal(calls[0].url.searchParams.get("page_token"), "older");
  });
  it("pauses and resumes inboxes through status", async () => {
    const calls = mock({ inbox_id: inboxId, status: "paused" });
    await run("inbox.update", { ...inbox, status: "paused" });
    assert.deepEqual(calls[0].body, { status: "paused" });
    assert.equal(valid("inbox.update", { ...inbox, status: "stopped" }), false);
    assert.equal(valid("inbox.create", { status: "deleted" }), false);
  });
  it("sends attachments and email headers without confusing them with HTTP headers", async () => {
    const calls = mock(receipt);
    await run("message.send", {
      ...inbox,
      to: ["a@example.com"],
      html: "<p>Hello</p>",
      trackOpens: false,
      headers: { "X-Custom-Name": "untouched", Authorization: "email-header" },
      attachments: [
        {
          name: "note.txt",
          mimeType: "text/plain",
          contentBase64: "aGk=",
          inline: false,
          contentId: "cid",
        },
      ],
      idempotencyKey: "send-123",
    });
    const body = calls[0].body as Record<string, unknown>;
    assert.deepEqual(body.attachments, [
      {
        filename: "note.txt",
        content_type: "text/plain",
        content: "aGk=",
        content_disposition: "attachment",
        content_id: "cid",
      },
    ]);
    assert.deepEqual(body.headers, {
      "X-Custom-Name": "untouched",
      Authorization: "email-header",
    });
    assert.equal(body.track_opens, false);
    assert.equal(body.idempotency_key, undefined);
    assert.equal(header(calls[0].init, "idempotency-key"), "send-123");
    assert.equal(header(calls[0].init, "authorization"), "Bearer test-key");
  });
  it("sets the idempotency header on all send paths without adding it to email JSON", async () => {
    for (const name of sends) {
      const calls = mock(receipt);
      await run(name, { ...routeInput(name), idempotencyKey: "stable-send" });
      assert.equal(header(calls[0].init, "idempotency-key"), "stable-send");
      assert.equal("idempotency_key" in (calls[0].body as object), false);
    }
    const calls = mock();
    await run("inbox.create", { clientId: "c" });
    assert.equal(header(calls[0].init, "idempotency-key"), null);
  });
  it("exposes one attachment variant per byte source for discovery and rejects ambiguous sources", () => {
    for (const [name, key] of attachmentWrites) {
      const variants = helpInputs(action(name).inputSchema)[key].items
        ?.variants;
      assert.equal(variants?.length, 4, name);
      for (const [i, source] of [
        "contentBase64",
        "contentPath",
        "content",
        "url",
      ].entries())
        assert.equal(
          variants?.[i].properties?.[source].required,
          true,
          `${name} ${source}`,
        );
      for (const variant of variants ?? [])
        assert.equal(variant.properties?.mimeType.type, "string", name);
    }
    for (const attachment of [
      {},
      { contentBase64: "aGk=", url: "https://example.com/a" },
      { content: "hi", contentPath: "/tmp/a" },
      { url: "http://example.com/a" },
      { contentBase64: "aGk=", extra: 1 },
      { contentBase64: "aGk=", filename: "old-name.txt" },
      { contentBase64: { contentBase64: "aGk=", extra: 1 } },
    ])
      assert.equal(
        valid("message.send", {
          ...inbox,
          to: "a@example.com",
          attachments: [attachment],
        }),
        false,
        JSON.stringify(attachment),
      );
    for (const attachment of [
      { url: "https://example.com/a" },
      { content: "a,b\n1,2", name: "data.csv", mimeType: "text/csv" },
      { contentPath: "/tmp/report.pdf" },
      { contentBase64: { name: "x.pdf", mimeType: "a/b", contentBase64: "" } },
    ])
      assert.ok(
        valid("message.send", {
          ...inbox,
          to: "a@example.com",
          attachments: [attachment],
        }),
        JSON.stringify(attachment),
      );
  });
  it("normalizes base64 the way gmail does and refuses invalid base64 before IO", async () => {
    let calls = mock(receipt);
    for (const [input, wire] of [
      ["aGk=", "aGk="],
      ["aGk", "aGk="],
      ["aGk=\n", "aGk="],
      ["aG-_", "aG+/"],
      ["YW Jj\r\nZA", "YWJjZA=="],
    ]) {
      await run("message.send", {
        ...inbox,
        to: "a@example.com",
        attachments: [{ contentBase64: input }],
      });
      assert.deepEqual(
        (calls.at(-1)?.body as { attachments: unknown }).attachments,
        [{ content: wire }],
        input,
      );
    }
    calls = mock();
    for (const [name, key] of attachmentWrites)
      for (const content of ["a", "a===", "abcde", "!!!", "aGk=aGk="])
        await assert.rejects(
          () =>
            run(name, {
              ...routeInput(name),
              [key]: [{ contentBase64: content }],
            }),
          /not valid base64/,
        );
    assert.equal(calls.length, 0);
  });
  it("validates multi-megabyte base64 without exhausting the regex engine", async () => {
    const calls = mock(receipt);
    const contentBase64 = "A".repeat(4_400_000);
    await run("message.send", {
      ...inbox,
      to: "a@example.com",
      attachments: [{ contentBase64 }],
    });
    assert.equal(calls.length, 1);
  });
  it("attaches local files, UTF-8 text and googleDrive download results", async () => {
    const file = join(dir, "report.pdf");
    writeFileSync(file, Buffer.from("%PDF-1"));
    const calls = mock(receipt);
    await run("message.send", {
      ...inbox,
      to: "a@example.com",
      attachments: [
        { contentPath: file, mimeType: "application/pdf" },
        { content: "a,b\n1,2", name: "data.csv", mimeType: "text/csv" },
        { content: "note" },
        {
          contentBase64: {
            name: "drive.txt",
            mimeType: "text/plain",
            size: 2,
            contentBase64: "aGk=",
          },
        },
        {
          name: "override.txt",
          contentBase64: { name: "drive.txt", contentBase64: "aGk=" },
        },
      ],
    });
    assert.deepEqual((calls[0].body as { attachments: unknown }).attachments, [
      {
        filename: "report.pdf",
        content_type: "application/pdf",
        content: Buffer.from("%PDF-1").toString("base64"),
      },
      {
        filename: "data.csv",
        content_type: "text/csv",
        content: Buffer.from("a,b\n1,2").toString("base64"),
      },
      {
        content_type: "text/plain",
        content: Buffer.from("note").toString("base64"),
      },
      { filename: "drive.txt", content_type: "text/plain", content: "aGk=" },
      { filename: "override.txt", content: "aGk=" },
    ]);
    const empty = join(dir, "empty.txt");
    writeFileSync(empty, "");
    const big = join(dir, "big.bin");
    writeFileSync(big, Buffer.alloc(4_500_001));
    const sub = join(dir, "sub");
    mkdirSync(sub);
    const refused = mock();
    for (const [contentPath, pattern] of [
      [join(dir, "missing.txt"), /contentPath is unreadable \(ENOENT\)/],
      [empty, /attachment 0 is empty/],
      [sub, /must be a regular file/],
      [big, /6 MB/],
    ] as const)
      await assert.rejects(
        () =>
          run("message.send", {
            ...inbox,
            to: "a@example.com",
            attachments: [{ contentPath }],
          }),
        pattern,
      );
    for (const attachment of [
      { content: "" },
      { contentBase64: " \n" },
      { contentBase64: { contentBase64: "" } },
    ])
      await assert.rejects(
        () =>
          run("message.send", {
            ...inbox,
            to: "a@example.com",
            attachments: [attachment],
          }),
        /attachment 0 is empty/,
      );
    assert.equal(refused.length, 0);
  });
  it("refuses a FIFO attachment without waiting for a writer", {
    skip: process.platform === "win32",
  }, async () => {
    const fifo = join(dir, "fifo");
    execFileSync("mkfifo", [fifo]);
    const calls = mock();
    await assert.rejects(
      () =>
        run("message.send", {
          ...inbox,
          to: "a@example.com",
          attachments: [{ contentPath: fifo }],
        }),
      /must be a regular file/,
    );
    assert.equal(calls.length, 0);
  });
  it("preserves inline and URL attachments and rejects unsafe URLs on every write surface", async () => {
    for (const [name, key] of attachmentWrites) {
      const items = [
        { contentBase64: "aGk=", mimeType: "text/plain", name: "note.txt" },
        {
          url: "https://example.com/file?signature=a%2Bb",
          inline: true,
          contentId: "image",
        },
      ];
      const input = { ...routeInput(name), [key]: items };
      assert.ok(valid(name, input), name);
      const calls = mock(receipt);
      await run(name, input);
      assert.equal(calls.length, 1, name);
      assert.deepEqual(
        (calls[0].body as Record<string, unknown>)[wireKey(key)],
        [
          { content: "aGk=", content_type: "text/plain", filename: "note.txt" },
          {
            url: "https://example.com/file?signature=a%2Bb",
            content_disposition: "inline",
            content_id: "image",
          },
        ],
        name,
      );
      for (const url of [
        "https://",
        "http://example.com/file",
        "https://user:secret@example.com/file",
      ])
        await assert.rejects(
          () => run(name, { ...routeInput(name), [key]: [{ url }] }),
          /HTTPS/,
        );
      assert.equal(calls.length, 1, name);
    }
  });
  it("documents provider limitations on every affected action", () => {
    for (const name of ["message.search", "thread.search"])
      assert.match(
        action(name).description ?? "",
        /excludes spam, trash, blocked and unauthenticated/,
      );
    for (const name of ["message.list", "thread.list"])
      assert.match(action(name).description ?? "", /agent-armor-held/);
    for (const name of [
      "message.attachment",
      "thread.attachment",
      "draft.attachment",
    ])
      assert.match(action(name).description ?? "", /text_url/);
    assert.match(
      action("message.batchGet").description ?? "",
      /without bodies.*message.get/,
    );
    assert.match(
      action("thread.update").description ?? "",
      /100 or more messages/,
    );
    assert.match(
      action("inbox.search").description ?? "",
      /empty and still carry next_page_token/,
    );
  });
  it("rejects unknown input names, wrong types, no-op changes, unbounded batches and invalid dates in the schema", () => {
    for (const [name, input] of [
      ["inbox.list", { first: 5 }],
      ["inbox.list", { limit: 0 }],
      ["inbox.list", { limit: 101 }],
      ["inbox.search", {}],
      ["inbox.update", inbox],
      ["inbox.update", { ...inbox, displayName: undefined }],
      ["message.list", { ...inbox, includeSpam: "false" }],
      ["message.list", { ...inbox, after: "tomorrow" }],
      ["message.search", { ...inbox, query: " " }],
      ["message.update", message],
      ["message.update", { ...message, addLabels: undefined }],
      ["message.update", { ...message, addLabels: [] }],
      ["message.update", { ...message, addLabels: [], removeLabels: [] }],
      ["thread.update", thread],
      ["thread.update", { ...thread, addLabels: undefined }],
      ["thread.update", { ...thread, removeLabels: [] }],
      ["draft.update", draft],
      ["draft.update", { ...draft, text: undefined }],
      ["draft.update", { ...draft, addLabels: [] }],
      ["draft.update", { ...draft, removeAttachments: [] }],
      ["draft.update", { ...draft, addAttachments: [] }],
      ["message.batchGet", { ...inbox, messageIds: [] }],
      ["message.batchGet", { ...inbox, messageIds: ["m", "m"] }],
      ["message.batchUpdate", { ...inbox, messageIds: ["m"] }],
      ["message.batchUpdate", { ...inbox, messageIds: ["m"], addLabels: [] }],
      [
        "message.batchUpdate",
        {
          ...inbox,
          messageIds: Array.from({ length: 51 }, (_, i) => String(i)),
          addLabels: ["x"],
        },
      ],
      ["message.replyAll", { ...message, to: "override@example.com" }],
      ["message.send", inbox],
      ["message.send", { ...inbox, to: undefined, cc: undefined }],
      ["message.send", { ...inbox, to: [] }],
      ["message.send", { ...inbox, to: "" }],
      ["message.send", { ...inbox, to: "a@example.com", attachments: [] }],
      ["message.send", { ...inbox, to: "a", idempotencyKey: "bad\nheader" }],
      ["message.forward", message],
      ["inbox.create", { clientId: "has@email" }],
      ["inbox.update", { ...inbox, metadata: {} }],
      ["inbox.create", { metadata: { nested: {} } }],
      ["inbox.create", { metadata: { ["a".repeat(257)]: true } }],
      ["draft.create", { ...inbox, to: "array-required@example.com" }],
      ["draft.update", { ...draft, forwardOf: "m" }],
    ] as const)
      assert.equal(
        valid(name, input),
        false,
        `${name} ${JSON.stringify(input)}`,
      );
  });
  it("preserves nullable draft changes and supports scheduled reply drafts", async () => {
    let calls = mock({ draft_id: "d1" });
    await run("draft.create", {
      ...inbox,
      inReplyTo: "m1",
      replyAll: true,
      text: "Hello",
      sendAt: "2026-12-01T12:00:00Z",
      clientId: "draft-1",
    });
    assert.deepEqual(calls[0].body, {
      in_reply_to: "m1",
      reply_all: true,
      text: "Hello",
      send_at: "2026-12-01T12:00:00Z",
      client_id: "draft-1",
    });
    calls = mock({ draft_id: "d1" });
    await run("draft.update", {
      ...draft,
      to: [],
      cc: null,
      sendAt: null,
      addAttachments: [
        { url: "https://example.com/file", mimeType: "text/plain" },
      ],
      removeAttachments: ["old"],
    });
    assert.deepEqual(calls[0].body, {
      to: [],
      cc: null,
      send_at: null,
      add_attachments: [
        { url: "https://example.com/file", content_type: "text/plain" },
      ],
      remove_attachments: ["old"],
    });
  });
  it("refuses conflicting draft modes in the schema", () => {
    for (const input of [
      { ...inbox, inReplyTo: "m", forwardOf: "m" },
      { ...inbox, replyAll: true },
      { ...inbox, forwardOf: "m", replyAll: true },
      { ...inbox, inReplyTo: "m", replyAll: true, to: [] },
      { ...inbox, inReplyTo: "m", replyAll: true, bcc: ["a@example.com"] },
    ])
      assert.equal(valid("draft.create", input), false, JSON.stringify(input));
    for (const input of [
      { ...inbox, inReplyTo: "m", replyAll: true },
      { ...inbox, inReplyTo: "m", replyAll: false, to: ["a@example.com"] },
      { ...inbox, forwardOf: "m", to: ["a@example.com"] },
      { ...inbox, replyAll: false },
      { ...inbox, inReplyTo: "m", forwardOf: undefined },
    ])
      assert.ok(valid("draft.create", input), JSON.stringify(input));
  });
  it("accepts explicit clearing on every draft recipient field", async () => {
    for (const key of ["to", "cc", "bcc", "replyTo"]) {
      for (const value of [[], null]) {
        assert.ok(valid("draft.update", { ...draft, [key]: value }), key);
        const calls = mock({ draft_id: "d1" });
        await run("draft.update", { ...draft, [key]: value });
        assert.deepEqual(calls[0].body, {
          [key === "replyTo" ? "reply_to" : key]: value,
        });
      }
    }
  });
  it("bounds serialized UTF-8 request size and refuses credential-bearing attachment URLs", async () => {
    const calls = mock();
    await assert.rejects(
      () =>
        run("message.send", {
          ...inbox,
          to: "a@example.com",
          text: "א".repeat(3_000_000),
        }),
      /6 MB/,
    );
    await assert.rejects(
      () =>
        run("draft.update", {
          ...draft,
          addAttachments: [{ url: "https://user:secret@example.com/file" }],
        }),
      /without embedded credentials/,
    );
    assert.equal(calls.length, 0);
  });
  it("enforces the exact serialized byte boundary", async () => {
    const body = { to: "a@example.com", text: "" };
    const overhead = Buffer.byteLength(JSON.stringify(body));
    body.text = "a".repeat(6_000_000 - overhead);
    const calls = mock(receipt);
    await run("message.send", { ...inbox, ...body });
    assert.equal(Buffer.byteLength(String(calls[0].init.body)), 6_000_000);
    await assert.rejects(
      () => run("message.send", { ...inbox, ...body, text: `${body.text}a` }),
      /6 MB/,
    );
    assert.equal(calls.length, 1);
  });
  it("returns attachment download links without fetching them", async () => {
    const response = {
      attachment_id: "a",
      size: 2,
      download_url: "https://files.example/signed?token=secret",
      text_url: "https://files.example/text?token=secret",
      expires_at: "2026-12-01T00:00:00Z",
    };
    const calls = mock(response);
    assert.deepEqual(
      await run("message.attachment", { ...message, attachmentId: "a" }),
      response,
    );
    assert.equal(calls.length, 1);
  });
  it("rejects path-climbing IDs on every route before IO", async () => {
    const calls = mock();
    for (const [name, input] of routes) {
      for (const key of [
        "inboxId",
        "messageId",
        "threadId",
        "draftId",
        "attachmentId",
      ]) {
        if (!(key in input)) continue;
        for (const value of ["", ".", "..", "a/b", "a\\b"])
          await assert.rejects(() => run(name, { ...input, [key]: value }), {
            code: "request_not_allowed",
          });
      }
    }
    assert.equal(calls.length, 0);
  });
  it("reports AgentMail's error code, never its free text, and does not retry", async () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      const calls = mock(
        new Response("private provider detail test-key", { status }),
      );
      await assert.rejects(
        () => run("message.send", { ...inbox, to: "a@example.com" }),
        { message: `agentMail: request failed (HTTP ${status})`, status },
      );
      assert.equal(calls.length, 1);
    }
    for (const [body, expected] of [
      [
        {
          name: "ForbiddenError",
          code: "inbox_paused",
          message: "Forbidden test-key",
          fix: "Resume the inbox test-key",
        },
        "agentMail: request failed (HTTP 403 inbox_paused)",
      ],
      [
        { code: "has spaces test-key", message: "x" },
        "agentMail: request failed (HTTP 403)",
      ],
      [["not", "an", "object"], "agentMail: request failed (HTTP 403)"],
    ] as const) {
      mock(Response.json(body, { status: 403 }));
      await assert.rejects(
        () => run("inbox.get", inbox),
        (error: Error) => {
          assert.equal(error.message, expected);
          assert.ok(!error.message.includes("test-key"));
          return true;
        },
      );
    }
    mock(Response.json({ code: "idempotency_conflict" }, { status: 409 }));
    await assert.rejects(
      () =>
        run("message.send", {
          ...inbox,
          to: "a@example.com",
          idempotencyKey: "k",
        }),
      {
        message: "agentMail: request failed (HTTP 409 idempotency_conflict)",
      },
    );
  });
  it("says when a send's outcome is unknown and how to retry safely", async () => {
    for (const status of [500, 503]) {
      const calls = mock(new Response("detail test-key", { status }));
      await assert.rejects(
        () => run("message.send", { ...inbox, to: "a@example.com" }),
        (error: Error & { status?: number }) => {
          assert.match(
            error.message,
            new RegExp(
              `^agentMail: request failed \\(HTTP ${status}\\)\\. The email may have been sent; check message\\.list`,
            ),
          );
          assert.equal(error.status, status);
          assert.ok(!error.message.includes("test-key"));
          return true;
        },
      );
      assert.equal(calls.length, 1);
    }
    mock(new Response("", { status: 502 }));
    await assert.rejects(
      () => run("draft.send", { ...draft, idempotencyKey: "k" }),
      /may have been sent; retry only with the same idempotencyKey/,
    );
    // A local refusal never reached AgentMail, so it carries no such hint.
    const calls = mock();
    await assert.rejects(
      () =>
        run("message.send", {
          ...inbox,
          to: "a@example.com",
          attachments: [{ contentBase64: "a" }],
        }),
      {
        message: "agentMail: attachment 0 contentBase64 is not valid base64",
      },
    );
    assert.equal(calls.length, 0);
  });
  it("does not report send success without a message and thread receipt", async () => {
    for (const name of sends) {
      for (const response of [
        {},
        null,
        [],
        "ok",
        { message_id: "m" },
        { message_id: "", thread_id: "t" },
        { message_id: "m", thread_id: " " },
        { message_id: "m", thread_id: 1 },
        new Response(null, { status: 204 }),
      ]) {
        mock(response);
        await assert.rejects(() => run(name, routeInput(name)), {
          code: "invalid_response",
        });
      }
    }
    mock({});
    await assert.rejects(
      () => run("message.send", { ...inbox, to: "a@example.com" }),
      /may have been sent/,
    );
    mock(new Response("not json"));
    await assert.rejects(() => run("inbox.list"), { code: "invalid_response" });
    mock(new Response(null, { status: 204 }));
    assert.deepEqual(await run("draft.delete", draft), { success: true });
    mock(new Response("", { status: 200 }));
    assert.deepEqual(await run("inbox.delete", inbox), { success: true });
  });
  it("requires credentials locally and delegates sends to a host broker by target and idempotency key", async () => {
    const calls = mock();
    await assert.rejects(
      async () =>
        action("inbox.list").execute(
          {},
          { ...ctx, connection: { ...ctx.connection, config: {} } },
        ),
      { code: "invalid_credentials" },
    );
    const seen: { target: string; key?: string; auth?: string }[] = [];
    const host: ActionContext = {
      ...ctx,
      connection: { ...ctx.connection, config: {} },
      credentials: {
        async request(req) {
          seen.push({
            target: req.target,
            key: req.idempotencyKey,
            auth: req.headers?.Authorization,
          });
          assert.equal(req.headers?.["Idempotency-Key"], undefined);
          return Response.json(receipt);
        },
        async probe() {
          return { outcome: "unverified" };
        },
      },
    };
    await action("message.send").execute(
      { ...inbox, to: "a@example.com", idempotencyKey: "k" },
      host,
    );
    await action("inbox.create").execute({ clientId: "c" }, host);
    assert.deepEqual(seen, [
      { target: "send", key: "k", auth: undefined },
      { target: "api", key: undefined, auth: undefined },
    ]);
    assert.equal(calls.length, 0);
  });
});
