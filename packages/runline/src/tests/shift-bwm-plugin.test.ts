import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import shiftBwm from "../../../runline-plugins/shiftBwm/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;

const PREFIX = "/v1/services/business-world-model";

const SHIFT_BWM_ACTIONS = [
  "definition.get",
  "file.complete",
  "file.createUpload",
  "group.create",
  "group.delete",
  "group.list",
  "group.update",
  "group.updateMembers",
  "member.list",
  "merge.get",
  "objectType.list",
  "pipeline.list",
  "record.archive",
  "record.changeEvents",
  "record.create",
  "record.fileUrl",
  "record.get",
  "record.history",
  "record.links",
  "record.list",
  "record.merge",
  "record.update",
  "savedList.create",
  "savedList.get",
  "savedList.list",
  "savedList.records",
  "savedList.update",
] as const;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeShiftBwm(): PluginDef {
  const { api, resolve } = createPluginAPI("shiftBwm");
  shiftBwm(api);
  return resolve();
}

function getAction(plugin: PluginDef, name: string) {
  const action = plugin.actions.find((a) => a.name === name);
  assert.ok(action, `expected shiftBwm.${name} to be registered`);
  return action;
}

function ctx(config: Record<string, unknown> = {}): ActionContext {
  return {
    connection: {
      name: "shiftBwm",
      plugin: "shiftBwm",
      config: { apiKey: "sk_live_test", ...config },
    },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
}

type Reply = { status?: number; body?: unknown };

/** Scripted fetch: each call pops the next reply; `seen` records what was sent. */
function mockFetch(replies: Reply[]) {
  const seen: Array<{
    url: string;
    method: string;
    headers: Headers;
    body?: unknown;
  }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const reply = replies.shift();
    assert.ok(reply, `unexpected fetch #${seen.length}: ${String(input)}`);
    const status = reply.status ?? 200;
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(reply.body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return seen;
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec_1",
    objectType: "contact",
    createdAt: "2026-09-22T12:00:00.000Z",
    updatedAt: "2026-09-22T12:00:00.000Z",
    archivedAt: null,
    mergedIntoId: null,
    externalId: null,
    visibility: { mode: "org", groups: [], principals: [] },
    fields: { $name: { value: "Dana", valueType: "TEXT" } },
    relationships: {
      $account: { cardinality: "HAS_ONE", objectType: "account", values: [] },
    },
    ...overrides,
  };
}

function apiError(
  status: number,
  error: { type: string; message: string; code?: string; param?: string },
): Reply {
  return { status, body: { error } };
}

describe("shiftBwm plugin", () => {
  it("registers the Business World Model surface", () => {
    const plugin = makeShiftBwm();
    assert.equal(plugin.name, "shiftBwm");
    assert.deepEqual(plugin.actions.map((a) => a.name).sort(), [
      ...SHIFT_BWM_ACTIONS,
    ]);
  });

  it("declares read or write access on every action", () => {
    for (const action of makeShiftBwm().actions) {
      assert.ok(
        action.access === "read" || action.access === "write",
        `${action.name} lacks access`,
      );
    }
  });

  it("strictly validates every action schema", () => {
    for (const action of makeShiftBwm().actions) {
      const schema = action.inputSchema as {
        type?: string;
        additionalProperties?: boolean;
      };
      assert.equal(schema.type, "object", action.name);
      assert.equal(schema.additionalProperties, false, action.name);
    }
  });

  it("teaches the envelope shape and $-prefixed system keys in descriptions", () => {
    const plugin = makeShiftBwm();
    for (const name of ["record.create", "record.list", "record.get"]) {
      const description = getAction(plugin, name).description ?? "";
      assert.match(description, /\$name/, name);
      assert.match(description, /fields/, name);
      assert.match(description, /relationships/, name);
    }
    assert.match(
      getAction(plugin, "record.create").description ?? "",
      /definition\.get/,
    );
    const fieldsHelp = (
      getAction(plugin, "record.create").inputSchema as {
        properties: { fields: { description: string } };
      }
    ).properties.fields.description;
    assert.match(fieldsHelp, /\$title on task and note/);
    assert.match(fieldsHelp, /activity has no \$name/);
    assert.match(fieldsHelp, /\$subject plus \$type/);
    assert.match(fieldsHelp, /linkedin\.com\/in/);
  });

  it("warns that multi-value fields reject the equal filter operator", () => {
    const schema = getAction(makeShiftBwm(), "record.list").inputSchema as {
      properties: {
        filters: {
          items: { properties: { operator: { description: string } } };
        };
      };
    };
    const description =
      schema.properties.filters.items.properties.operator.description;
    assert.match(description, /EMAIL, TELEPHONE, URL/);
    assert.match(description, /reject equal/);
    assert.match(
      getAction(makeShiftBwm(), "record.list").description ?? "",
      /\$email \/ \$phone with no operator/,
    );
  });

  it("reads definitions with bearer auth against the production origin by default", async () => {
    const seen = mockFetch([
      {
        body: {
          objectType: "contact",
          fieldDefinitions: {},
          relationshipDefinitions: {},
        },
      },
    ]);
    const result = await getAction(makeShiftBwm(), "definition.get").execute(
      { objectType: "contact" },
      ctx(),
    );
    assert.equal(
      seen[0]?.url,
      `https://cloud.shift-labs.ai${PREFIX}/contacts/definitions`,
    );
    assert.equal(seen[0]?.method, "GET");
    assert.equal(seen[0]?.headers.get("authorization"), "Bearer sk_live_test");
    assert.deepEqual(result, {
      objectType: "contact",
      fieldDefinitions: {},
      relationshipDefinitions: {},
    });
  });

  it("routes custom object types under /objects", async () => {
    const seen = mockFetch([{ body: envelope({ objectType: "vendor" }) }]);
    await getAction(makeShiftBwm(), "record.get").execute(
      { objectType: "vendor", id: "rec_9" },
      ctx(),
    );
    assert.equal(
      seen[0]?.url,
      `https://cloud.shift-labs.ai${PREFIX}/objects/vendor/rec_9`,
    );
  });

  it("signs through the declared credential: redirects refused, deadline set", async () => {
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal, "every request carries a deadline");
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.test" },
      });
    }) as typeof fetch;
    await assert.rejects(
      getAction(makeShiftBwm(), "objectType.list").execute({}, ctx()),
      { code: "transport_failed" },
    );
  });

  it("refuses to run without an apiKey", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("fetch should not run");
    }) as typeof fetch;
    await assert.rejects(
      getAction(makeShiftBwm(), "objectType.list").execute(
        {},
        ctx({ apiKey: "" }),
      ),
      { code: "invalid_credentials" },
    );
    assert.equal(calls, 0);
  });

  it("serializes list filters as key[op]=value with pagination", async () => {
    const seen = mockFetch([
      { body: { data: [envelope()], object: "list", totalCount: 1 } },
    ]);
    const result = (await getAction(makeShiftBwm(), "record.list").execute(
      {
        objectType: "contact",
        filters: [
          { key: "$email", operator: "equal", value: "dana@acme.test" },
          { key: "$name", operator: "equal", negate: true, value: "Bob" },
          { key: "$account", value: "acc_1" },
        ],
        limit: 10,
        offset: 20,
        includeArchived: true,
      },
      ctx(),
    )) as { totalCount: number };
    const url = new URL(seen[0]?.url ?? "");
    assert.equal(url.pathname, `${PREFIX}/contacts`);
    assert.equal(url.searchParams.get("$email[equal]"), "dana@acme.test");
    assert.equal(url.searchParams.get("$name[-equal]"), "Bob");
    assert.equal(url.searchParams.get("$account"), "acc_1");
    assert.equal(url.searchParams.get("limit"), "10");
    assert.equal(url.searchParams.get("offset"), "20");
    assert.equal(url.searchParams.get("includeArchived"), "true");
    assert.equal(result.totalCount, 1);
  });

  it("creates records with bare values and a fresh Idempotency-Key", async () => {
    const seen = mockFetch([{ body: envelope() }, { body: envelope() }]);
    const action = getAction(makeShiftBwm(), "record.create");
    const input = {
      objectType: "contact",
      fields: { $name: "Dana", $email: ["dana@acme.test"] },
      relationships: { $account: "acc_1" },
    };
    await action.execute(input, ctx());
    await action.execute(input, ctx());

    assert.equal(seen[0]?.url, `https://cloud.shift-labs.ai${PREFIX}/contacts`);
    assert.equal(seen[0]?.method, "POST");
    assert.equal(seen[0]?.headers.get("content-type"), "application/json");
    assert.deepEqual(seen[0]?.body, {
      fields: { $name: "Dana", $email: ["dana@acme.test"] },
      relationships: { $account: "acc_1" },
    });
    const first = seen[0]?.headers.get("idempotency-key");
    const second = seen[1]?.headers.get("idempotency-key");
    assert.ok(first && first.length >= 32, "create carries an Idempotency-Key");
    assert.notEqual(first, second, "each create mints its own key");
  });

  it("does not send an Idempotency-Key on reads", async () => {
    const seen = mockFetch([{ body: envelope() }]);
    await getAction(makeShiftBwm(), "record.get").execute(
      { objectType: "contact", id: "rec_1" },
      ctx(),
    );
    assert.equal(seen[0]?.headers.get("idempotency-key"), null);
  });

  it("PATCHes updates and retries exactly once on write_conflict", async () => {
    const seen = mockFetch([
      apiError(409, {
        type: "conflict",
        message: "record changed",
        code: "write_conflict",
      }),
      {
        body: envelope({
          fields: { $name: { value: "Dana Cohen", valueType: "TEXT" } },
        }),
      },
    ]);
    const result = (await getAction(makeShiftBwm(), "record.update").execute(
      { objectType: "contact", id: "rec_1", fields: { $name: "Dana Cohen" } },
      ctx(),
    )) as { fields: { $name: { value: string } } };
    assert.equal(seen.length, 2);
    assert.equal(seen[0]?.method, "PATCH");
    assert.equal(
      seen[0]?.url,
      `https://cloud.shift-labs.ai${PREFIX}/contacts/rec_1`,
    );
    assert.deepEqual(seen[1]?.body, { fields: { $name: "Dana Cohen" } });
    assert.equal(result.fields.$name.value, "Dana Cohen");
  });

  it("surfaces a second write_conflict instead of looping", async () => {
    const conflict = apiError(409, {
      type: "conflict",
      message: "record changed",
      code: "write_conflict",
    });
    const seen = mockFetch([conflict, { ...conflict }]);
    await assert.rejects(
      getAction(makeShiftBwm(), "record.update").execute(
        { objectType: "contact", id: "rec_1", fields: { $name: "X" } },
        ctx(),
      ),
      /409 write_conflict/,
    );
    assert.equal(seen.length, 2);
  });

  it("folds code and param into the error message so the model can self-correct", async () => {
    mockFetch([
      apiError(422, {
        type: "unprocessable_content",
        message: "unknown field tier",
        code: "unknown_field",
        param: "fields.tier",
      }),
    ]);
    await assert.rejects(
      getAction(makeShiftBwm(), "record.create").execute(
        { objectType: "account", fields: { $name: "Acme", tier: "Gold" } },
        ctx(),
      ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /422 unknown_field/);
        assert.match(err.message, /param: fields\.tier/);
        assert.doesNotMatch(err.message, /unknown field tier/);
        assert.equal((err as { param?: string }).param, "fields.tier");
        assert.equal((err as { status?: number }).status, 422);
        return true;
      },
    );
  });

  it("reports a hidden or missing record as 404 not_found", async () => {
    mockFetch([
      apiError(404, { type: "not_found", message: "record not found" }),
    ]);
    await assert.rejects(
      getAction(makeShiftBwm(), "record.get").execute(
        { objectType: "note", id: "rec_private" },
        ctx(),
      ),
      /404 not_found/,
    );
  });

  it("archives with DELETE and reads history with limit/after", async () => {
    const seen = mockFetch([
      { body: envelope({ archivedAt: "2026-09-22T13:00:00.000Z" }) },
      {
        body: {
          data: [
            {
              value: "Dana Cohen",
              valueType: "TEXT",
              displayValue: "Dana Cohen",
              recordedAt: "2026-09-22T12:30:00.000Z",
              isCreate: false,
            },
          ],
          hasMore: false,
          nextCursor: null,
        },
      },
    ]);
    const plugin = makeShiftBwm();
    await getAction(plugin, "record.archive").execute(
      { objectType: "activity", id: "act_1" },
      ctx(),
    );
    await getAction(plugin, "record.history").execute(
      {
        objectType: "contact",
        id: "rec_1",
        field: "$name",
        limit: 5,
        after: "c1",
      },
      ctx(),
    );
    assert.equal(seen[0]?.method, "DELETE");
    assert.equal(
      seen[0]?.url,
      `https://cloud.shift-labs.ai${PREFIX}/activities/act_1`,
    );
    assert.equal(
      seen[1]?.url,
      `https://cloud.shift-labs.ai${PREFIX}/contacts/rec_1/fields/%24name/history?limit=5&after=c1`,
    );
  });

  it("reads links with a direction and change events", async () => {
    const seen = mockFetch([
      { body: { outbound: [], inbound: [] } },
      { body: { changeEvents: [] } },
    ]);
    const plugin = makeShiftBwm();
    await getAction(plugin, "record.links").execute(
      { id: "rec_1", direction: "out" },
      ctx(),
    );
    await getAction(plugin, "record.changeEvents").execute(
      { id: "rec_1" },
      ctx(),
    );
    assert.equal(
      seen[0]?.url,
      `https://cloud.shift-labs.ai${PREFIX}/records/rec_1/links?direction=out`,
    );
    assert.equal(
      seen[1]?.url,
      `https://cloud.shift-labs.ai${PREFIX}/records/rec_1/change-events`,
    );
  });

  it("merges through the object type's merge endpoint", async () => {
    const merge = {
      id: "mrg_1",
      createdAt: "2026-09-22T12:00:00.000Z",
      objectType: "contact",
      primaryId: "rec_1",
      duplicateId: "rec_2",
      status: "done",
      summary: { fieldWriteCount: 1, repointedCount: 2, warnings: [] },
    };
    const seen = mockFetch([
      { body: { merge, primary: envelope(), summary: merge.summary } },
    ]);
    await getAction(makeShiftBwm(), "record.merge").execute(
      {
        objectType: "contact",
        primaryId: "rec_1",
        duplicateId: "rec_2",
        fieldResolutions: { $name: "duplicate" },
      },
      ctx(),
    );
    assert.equal(
      seen[0]?.url,
      `https://cloud.shift-labs.ai${PREFIX}/contacts/merge`,
    );
    assert.deepEqual(seen[0]?.body, {
      primaryId: "rec_1",
      duplicateId: "rec_2",
      fieldResolutions: { $name: "duplicate" },
    });
    assert.ok(seen[0]?.headers.get("idempotency-key"));
  });

  it("shapes saved-list writes into the $name/$objectType/$records envelope", async () => {
    const list = {
      id: "lst_1",
      createdAt: "2026-09-22T12:00:00.000Z",
      updatedAt: "2026-09-22T12:00:00.000Z",
      archivedAt: null,
      fields: {
        $name: { value: "Hot leads", valueType: "TEXT" },
        $objectType: { value: "contact", valueType: "TEXT" },
        $description: { value: null, valueType: "TEXT" },
      },
      relationships: {
        $records: {
          cardinality: "HAS_MANY",
          objectType: "contact",
          values: ["rec_1"],
        },
      },
    };
    const seen = mockFetch([{ body: list }, { body: list }]);
    const plugin = makeShiftBwm();
    await getAction(plugin, "savedList.create").execute(
      { name: "Hot leads", objectType: "contact", records: ["rec_1"] },
      ctx(),
    );
    await getAction(plugin, "savedList.update").execute(
      { id: "lst_1", records: { add: "rec_2" } },
      ctx(),
    );
    assert.deepEqual(seen[0]?.body, {
      fields: { $name: "Hot leads", $objectType: "contact" },
      relationships: { $records: ["rec_1"] },
    });
    assert.equal(seen[1]?.method, "PATCH");
    assert.deepEqual(seen[1]?.body, {
      relationships: { $records: { add: "rec_2" } },
    });
  });

  it("manages groups and their principals", async () => {
    const group = {
      id: "grp_1",
      slug: "sales",
      name: "Sales",
      description: null,
      members: [{ type: "service", id: "key_1" }],
      createdAt: "2026-09-22T12:00:00.000Z",
      updatedAt: "2026-09-22T12:00:00.000Z",
    };
    const seen = mockFetch([
      { body: { group } },
      { body: { group } },
      { status: 204 },
    ]);
    const plugin = makeShiftBwm();
    await getAction(plugin, "group.create").execute(
      {
        slug: "sales",
        name: "Sales",
        members: [{ type: "service", id: "key_1" }],
      },
      ctx(),
    );
    await getAction(plugin, "group.updateMembers").execute(
      { id: "grp_1", add: [{ type: "user", id: "user_1" }] },
      ctx(),
    );
    const deleted = await getAction(plugin, "group.delete").execute(
      { id: "grp_1" },
      ctx(),
    );
    assert.equal(seen[0]?.url, `https://cloud.shift-labs.ai${PREFIX}/groups`);
    assert.equal(
      seen[1]?.url,
      `https://cloud.shift-labs.ai${PREFIX}/groups/grp_1/members`,
    );
    assert.deepEqual(seen[1]?.body, { add: [{ type: "user", id: "user_1" }] });
    assert.equal(seen[2]?.method, "DELETE");
    assert.deepEqual(deleted, { id: "grp_1", deleted: true });
  });

  it("lists members and mints record file URLs", async () => {
    const seen = mockFetch([
      { body: { data: [], object: "list", totalCount: 0 } },
      {
        body: {
          url: "https://files.example/x",
          expiresAt: "2026-09-22T13:00:00.000Z",
        },
      },
    ]);
    const plugin = makeShiftBwm();
    await getAction(plugin, "member.list").execute({ limit: 50 }, ctx());
    await getAction(plugin, "record.fileUrl").execute(
      { recordId: "rec_1", fileId: "file_1" },
      ctx(),
    );
    assert.equal(
      seen[0]?.url,
      `https://cloud.shift-labs.ai${PREFIX}/members?limit=50`,
    );
    assert.equal(
      seen[1]?.url,
      `https://cloud.shift-labs.ai${PREFIX}/records/rec_1/files/file_1/url`,
    );
  });
});
