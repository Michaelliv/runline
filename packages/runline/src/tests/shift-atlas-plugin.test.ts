import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Check } from "typebox/value";
import shiftAtlas from "../../../runline-plugins/shiftAtlas/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;

const SHIFT_ATLAS_ACTIONS = [
  "actor.create",
  "actor.delete",
  "actor.list",
  "actor.update",
  "assignment.create",
  "assignment.delete",
  "binding.create",
  "binding.delete",
  "binding.update",
  "change.list",
  "evidence.create",
  "evidence.delete",
  "evidence.update",
  "graph.get",
  "journey.create",
  "journey.delete",
  "journey.get",
  "journey.list",
  "journey.update",
  "labels.get",
  "labels.update",
  "line.create",
  "line.delete",
  "line.list",
  "line.update",
  "relation.create",
  "relation.delete",
  "stage.create",
  "stage.delete",
  "stage.get",
  "stage.update",
  "summary",
  "task.create",
  "task.delete",
  "task.update",
] as const;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeShiftAtlas(): PluginDef {
  const { api, resolve } = createPluginAPI("shiftAtlas");
  shiftAtlas(api);
  return resolve();
}

function getAction(plugin: PluginDef, name: string) {
  const action = plugin.actions.find((a) => a.name === name);
  assert.ok(action, `expected shiftAtlas.${name} to be registered`);
  return action;
}

function ctx(): ActionContext {
  return {
    connection: {
      name: "shiftAtlas",
      plugin: "shiftAtlas",
      config: { apiKey: "shift_api_key" },
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

describe("shiftAtlas plugin", () => {
  it("registers the whole operational graph surface", () => {
    const plugin = makeShiftAtlas();
    assert.equal(plugin.name, "shiftAtlas");
    assert.deepEqual(plugin.actions.map((a) => a.name).sort(), [
      ...SHIFT_ATLAS_ACTIONS,
    ]);
  });

  it("strictly validates every action schema", () => {
    for (const action of makeShiftAtlas().actions) {
      const schema = action.inputSchema as {
        type?: string;
        additionalProperties?: boolean;
      };
      assert.equal(schema.type, "object", action.name);
      assert.equal(schema.additionalProperties, false, action.name);
    }
  });

  it("reads the summary with bearer auth against the service base path", async () => {
    const action = getAction(makeShiftAtlas(), "summary");

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://cloud.shift-labs.ai/v1/services/operational-graph/summary",
      );
      assert.equal(init?.method, undefined);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer shift_api_key");
      return { summary: { lines: [], rollup: { total: 0 } } };
    });

    assert.deepEqual(await action.execute({}, ctx()), {
      lines: [],
      rollup: { total: 0 },
    });
  });

  it("creates a task under its stage and strips the routing key from the body", async () => {
    const action = getAction(makeShiftAtlas(), "task.create");

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://cloud.shift-labs.ai/v1/services/operational-graph/stages/stg_1/tasks",
      );
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        description: "Answer the inbound enquiry within two minutes",
        intendedMode: "ai",
        actorId: "act_1",
      });
      return { task: { id: "tsk_1", stageId: "stg_1" } };
    });

    assert.deepEqual(
      await action.execute(
        {
          stageId: "stg_1",
          description: "Answer the inbound enquiry within two minutes",
          intendedMode: "ai",
          actorId: "act_1",
        },
        ctx(),
      ),
      { id: "tsk_1", stageId: "stg_1" },
    );
  });

  it("supports tri-state task updates and rejects no-op updates", async () => {
    const update = getAction(makeShiftAtlas(), "task.update");
    assert.equal(Check(update.inputSchema as never, { id: "tsk_1" }), false);
    assert.equal(
      Check(update.inputSchema as never, { id: "tsk_1", actorId: null }),
      true,
    );
    assert.equal(
      Check(update.inputSchema as never, { id: "tsk_1", typo: true }),
      false,
    );

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://cloud.shift-labs.ai/v1/services/operational-graph/tasks/tsk_1",
      );
      assert.equal(init?.method, "PATCH");
      assert.deepEqual(JSON.parse(String(init?.body)), { actorId: null });
      return { task: { id: "tsk_1" } };
    });

    assert.deepEqual(
      await update.execute({ id: "tsk_1", actorId: null }, ctx()),
      { id: "tsk_1" },
    );
  });

  it("rejects unknown enum values before calling the API", () => {
    const plugin = makeShiftAtlas();
    const relation = getAction(plugin, "relation.create");
    assert.equal(
      Check(relation.inputSchema as never, {
        kind: "follows",
        fromId: "a",
        toId: "b",
      }),
      true,
    );
    assert.equal(
      Check(relation.inputSchema as never, {
        kind: "contains",
        fromId: "a",
        toId: "b",
      }),
      false,
    );
    const binding = getAction(plugin, "binding.create");
    assert.equal(
      Check(binding.inputSchema as never, {
        taskId: "t",
        executor: "vex",
        label: "Echo",
        status: "live",
      }),
      true,
    );
    assert.equal(
      Check(binding.inputSchema as never, {
        taskId: "t",
        executor: "robot",
        label: "Echo",
      }),
      false,
    );
  });

  it("deletes through DELETE and reports the deletion", async () => {
    const action = getAction(makeShiftAtlas(), "evidence.delete");

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://cloud.shift-labs.ai/v1/services/operational-graph/evidence/evd_1",
      );
      assert.equal(init?.method, "DELETE");
      return null;
    });

    assert.deepEqual(await action.execute({ id: "evd_1" }, ctx()), {
      deleted: true,
      id: "evd_1",
    });
  });

  it("passes change-log filters as query params", async () => {
    const action = getAction(makeShiftAtlas(), "change.list");

    mockShift((input) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/v1/services/operational-graph/changes");
      assert.equal(url.searchParams.get("entityType"), "task");
      assert.equal(url.searchParams.get("limit"), "10");
      return { changes: [{ id: "chg_1" }], nextCursor: "next_1" };
    });

    assert.deepEqual(
      await action.execute({ entityType: "task", limit: 10 }, ctx()),
      { changes: [{ id: "chg_1" }], nextCursor: "next_1" },
    );
  });
});
