import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Check } from "typebox/value";
import shiftCrm from "../../../runline-plugins/shiftCrm/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;

const SHIFT_CRM_ACTIONS = [
  "access.grant",
  "access.list",
  "access.me",
  "access.revoke",
  "account.create",
  "account.get",
  "account.list",
  "account.listPage",
  "account.update",
  "activity.list",
  "activity.listPage",
  "activity.log",
  "import.commit",
  "import.commitRow",
  "import.create",
  "import.get",
  "import.list",
  "import.skipRow",
  "import.stageRows",
  "opportunity.create",
  "opportunity.get",
  "opportunity.list",
  "opportunity.listPage",
  "opportunity.update",
  "person.create",
  "person.get",
  "person.list",
  "person.listPage",
  "person.update",
  "pipeline.create",
  "pipeline.get",
  "pipeline.list",
  "propertyDefinition.create",
  "propertyDefinition.list",
  "record.changeEvents",
  "task.create",
  "task.get",
  "task.list",
  "task.listPage",
  "task.update",
] as const;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeShiftCrm(): PluginDef {
  const { api, resolve } = createPluginAPI("shiftCrm");
  shiftCrm(api);
  return resolve();
}

function getAction(plugin: PluginDef, name: string) {
  const action = plugin.actions.find((a) => a.name === name);
  assert.ok(action, `expected shiftCrm.${name} to be registered`);
  return action;
}

function ctx(config: Record<string, unknown> = {}): ActionContext {
  return {
    connection: {
      name: "shiftCrm",
      plugin: "shiftCrm",
      config: {
        apiKey: "shift_user_token",
        ...config,
      },
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
    if (data === null) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function noFetch(): () => number {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("fetch should not run");
  }) as typeof fetch;
  return () => calls;
}

describe("shiftCrm plugin", () => {
  it("registers one Shift CRM plugin covering the whole /v1/crm surface", () => {
    const plugin = makeShiftCrm();
    assert.equal(plugin.name, "shiftCrm");
    assert.deepEqual(plugin.actions.map((a) => a.name).sort(), [
      ...SHIFT_CRM_ACTIONS,
    ]);
  });

  it("strictly validates every Shift CRM action schema", () => {
    for (const action of makeShiftCrm().actions) {
      const schema = action.inputSchema as {
        type?: string;
        additionalProperties?: boolean;
      };
      assert.equal(schema.type, "object", action.name);
      assert.equal(schema.additionalProperties, false, action.name);
    }
  });

  it("creates accounts with bearer auth against the CRM base path", async () => {
    const action = getAction(makeShiftCrm(), "account.create");

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://cloud.shift-labs.ai/v1/crm/accounts",
      );
      assert.equal(init?.method, "POST");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer shift_user_token");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        name: "Acme",
        domain: "acme.com",
        externalRefs: [{ sourceSystem: "hubspot", sourceId: "123" }],
      });
      return { account: { id: "rec_1", recordType: "account", name: "Acme" } };
    });

    assert.deepEqual(
      await action.execute(
        {
          name: "Acme",
          domain: "acme.com",
          externalRefs: [{ sourceSystem: "hubspot", sourceId: "123" }],
        },
        ctx(),
      ),
      { id: "rec_1", recordType: "account", name: "Acme" },
    );
  });

  it("exposes cursor pagination capped at the API's 200-row page size", async () => {
    const plugin = makeShiftCrm();
    const page = getAction(plugin, "account.listPage");
    assert.ok(page.inputSchema);
    assert.equal(Check(page.inputSchema as never, { limit: 200 }), true);
    assert.equal(Check(page.inputSchema as never, { limit: 201 }), false);
    assert.equal(Check(page.inputSchema as never, { cursor: "" }), false);

    mockShift((input) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/v1/crm/accounts");
      assert.equal(url.searchParams.get("cursor"), "next_1");
      assert.equal(url.searchParams.get("limit"), "100");
      assert.equal(url.searchParams.get("includeArchived"), "true");
      return { accounts: [{ id: "rec_2" }], nextCursor: "next_2" };
    });

    assert.deepEqual(
      await page.execute(
        { cursor: "next_1", limit: 100, includeArchived: true },
        ctx(),
      ),
      { accounts: [{ id: "rec_2" }], nextCursor: "next_2" },
    );
  });

  it("supports tri-state PATCH semantics and rejects no-op updates", async () => {
    const plugin = makeShiftCrm();
    const update = getAction(plugin, "account.update");
    assert.equal(Check(update.inputSchema as never, { id: "rec_1" }), false);
    assert.equal(
      Check(update.inputSchema as never, { id: "rec_1", domain: null }),
      true,
    );
    assert.equal(
      Check(update.inputSchema as never, { id: "rec_1", archived: true }),
      true,
    );
    assert.equal(
      Check(update.inputSchema as never, { id: "rec_1", typo: true }),
      false,
    );

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://cloud.shift-labs.ai/v1/crm/accounts/rec_1",
      );
      assert.equal(init?.method, "PATCH");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        domain: null,
        archived: true,
      });
      return { account: { id: "rec_1", archivedAt: "2026-07-14T12:00:00Z" } };
    });

    assert.deepEqual(
      await update.execute(
        { id: "rec_1", domain: null, archived: true },
        ctx(),
      ),
      { id: "rec_1", archivedAt: "2026-07-14T12:00:00Z" },
    );
  });

  it("rejects invalid person details before calling the API", async () => {
    const action = getAction(makeShiftCrm(), "person.create");
    const fetchCalls = noFetch();

    await assert.rejects(
      () =>
        action.execute(
          {
            name: "Dana",
            identities: [
              { kind: "email", value: "a@x.com", isPrimary: true },
              { kind: "email", value: "b@x.com", isPrimary: true },
            ],
          },
          ctx(),
        ),
      /one primary email identity/,
    );
    await assert.rejects(
      () =>
        action.execute(
          {
            name: "Dana",
            accounts: [
              { accountId: "acc_1", isPrimary: true },
              { accountId: "acc_2", isPrimary: true },
            ],
          },
          ctx(),
        ),
      /one current primary account/,
    );
    await assert.rejects(
      () =>
        action.execute(
          {
            name: "Dana",
            accounts: [{ accountId: "acc_1" }, { accountId: "acc_1" }],
          },
          ctx(),
        ),
      /Duplicate account affiliation/,
    );
    assert.equal(fetchCalls(), 0);
  });

  it("requires activities to link to at least one record", async () => {
    const action = getAction(makeShiftCrm(), "activity.log");
    const fetchCalls = noFetch();

    await assert.rejects(
      () =>
        action.execute({ activityType: "call", subject: "Intro call" }, ctx()),
      /at least one CRM record/,
    );
    await assert.rejects(
      () =>
        action.execute(
          {
            activityType: "call",
            subject: "Intro call",
            relationships: [
              { toRecordId: "rec_1", relationshipType: "attendee" },
            ],
            startedAt: "2026-07-14T13:00:00.000Z",
            endedAt: "2026-07-14T12:00:00.000Z",
          },
          ctx(),
        ),
      /endedAt must not precede startedAt/,
    );
    assert.equal(fetchCalls(), 0);
  });

  it("logs linked activities", async () => {
    const action = getAction(makeShiftCrm(), "activity.log");

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://cloud.shift-labs.ai/v1/crm/activities",
      );
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        activityType: "call",
        subject: "Intro call",
        relationships: [{ toRecordId: "rec_1", relationshipType: "attendee" }],
      });
      return { activity: { id: "act_1", subject: "Intro call" } };
    });

    assert.deepEqual(
      await action.execute(
        {
          activityType: "call",
          subject: "Intro call",
          relationships: [
            { toRecordId: "rec_1", relationshipType: "attendee" },
          ],
        },
        ctx(),
      ),
      { id: "act_1", subject: "Intro call" },
    );
  });

  it("rejects duplicate pipeline stage keys and positions before calling the API", async () => {
    const action = getAction(makeShiftCrm(), "pipeline.create");
    const fetchCalls = noFetch();

    await assert.rejects(
      () =>
        action.execute(
          {
            name: "Sales",
            stages: [
              { key: "new", name: "New", position: 0 },
              { key: "new", name: "Again", position: 1 },
            ],
          },
          ctx(),
        ),
      /Duplicate pipeline stage key/,
    );
    await assert.rejects(
      () =>
        action.execute(
          {
            name: "Sales",
            stages: [
              { key: "new", name: "New", position: 0 },
              { key: "won", name: "Won", position: 0 },
            ],
          },
          ctx(),
        ),
      /Duplicate pipeline stage position/,
    );
    assert.equal(fetchCalls(), 0);
  });

  it("enforces enum option rules on property definitions before calling the API", async () => {
    const action = getAction(makeShiftCrm(), "propertyDefinition.create");
    const fetchCalls = noFetch();

    await assert.rejects(
      () =>
        action.execute(
          {
            recordType: "account",
            key: "tier",
            label: "Tier",
            dataType: "enum",
          },
          ctx(),
        ),
      /require options/,
    );
    await assert.rejects(
      () =>
        action.execute(
          {
            recordType: "account",
            key: "arr",
            label: "ARR",
            dataType: "number",
            options: ["a"],
          },
          ctx(),
        ),
      /only allowed on enum/,
    );
    await assert.rejects(
      () =>
        action.execute(
          {
            recordType: "account",
            key: "code",
            label: "Code",
            dataType: "string",
            validation: { pattern: "(" },
          },
          ctx(),
        ),
      /valid regex/,
    );
    assert.equal(
      Check(action.inputSchema as never, {
        recordType: "account",
        key: "Tier",
        label: "Tier",
        dataType: "string",
      }),
      false,
    );
    assert.equal(fetchCalls(), 0);
  });

  it("revokes access grants through DELETE and reports revocation", async () => {
    const action = getAction(makeShiftCrm(), "access.revoke");

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://cloud.shift-labs.ai/v1/crm/access/user_1",
      );
      assert.equal(init?.method, "DELETE");
      return null;
    });

    assert.deepEqual(await action.execute({ userId: "user_1" }, ctx()), {
      revoked: true,
    });
  });

  it("walks the import protocol: create, stage, commit row, skip row, commit run", async () => {
    const plugin = makeShiftCrm();
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];

    mockShift((input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.endsWith("/v1/crm/imports")) {
        return { importRun: { id: "run_1", status: "staged" } };
      }
      if (url.endsWith("/rows")) {
        return { rows: [{ id: "row_1", status: "pending" }] };
      }
      if (url.endsWith("/rows/row_1/commit")) {
        return { record: { id: "rec_1", recordType: "account" } };
      }
      if (url.endsWith("/rows/row_2/skip")) {
        return { row: { id: "row_2", status: "skipped" } };
      }
      if (url.endsWith("/imports/run_1/commit")) {
        return { importRun: { id: "run_1", status: "committed" } };
      }
      throw new Error(`unexpected request: ${url}`);
    });

    assert.deepEqual(
      await getAction(plugin, "import.create").execute(
        { sourceSystem: "hubspot" },
        ctx(),
      ),
      { id: "run_1", status: "staged" },
    );
    assert.deepEqual(
      await getAction(plugin, "import.stageRows").execute(
        {
          importRunId: "run_1",
          rows: [
            {
              sourceId: "123",
              recordType: "account",
              rawPayload: { name: "Acme" },
            },
          ],
        },
        ctx(),
      ),
      [{ id: "row_1", status: "pending" }],
    );
    assert.deepEqual(
      await getAction(plugin, "import.commitRow").execute(
        {
          importRunId: "run_1",
          rowId: "row_1",
          transformedPayload: { name: "Acme" },
        },
        ctx(),
      ),
      { id: "rec_1", recordType: "account" },
    );
    assert.deepEqual(
      await getAction(plugin, "import.skipRow").execute(
        { importRunId: "run_1", rowId: "row_2" },
        ctx(),
      ),
      { id: "row_2", status: "skipped" },
    );
    assert.deepEqual(
      await getAction(plugin, "import.commit").execute({ id: "run_1" }, ctx()),
      { id: "run_1", status: "committed" },
    );

    assert.deepEqual(
      calls.map((call) => call.body),
      [
        { sourceSystem: "hubspot" },
        {
          rows: [
            {
              sourceId: "123",
              recordType: "account",
              rawPayload: { name: "Acme" },
            },
          ],
        },
        { transformedPayload: { name: "Acme" } },
        undefined,
        undefined,
      ],
    );
  });

  it("lists change events for a record", async () => {
    const action = getAction(makeShiftCrm(), "record.changeEvents");

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://cloud.shift-labs.ai/v1/crm/records/rec_1/change-events",
      );
      assert.equal(init?.method, undefined);
      return { changeEvents: [{ id: "evt_1", action: "created" }] };
    });

    assert.deepEqual(await action.execute({ recordId: "rec_1" }, ctx()), [
      { id: "evt_1", action: "created" },
    ]);
  });

  it("filters property definitions by record type via query params", async () => {
    const action = getAction(makeShiftCrm(), "propertyDefinition.list");

    mockShift((input) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/v1/crm/property-definitions");
      assert.equal(url.searchParams.get("recordType"), "person");
      return { propertyDefinitions: [{ id: "def_1", key: "region" }] };
    });

    assert.deepEqual(await action.execute({ recordType: "person" }, ctx()), [
      { id: "def_1", key: "region" },
    ]);
  });
});
