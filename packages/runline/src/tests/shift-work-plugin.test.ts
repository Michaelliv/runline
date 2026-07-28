import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Check } from "typebox/value";
import shiftWork from "../../../runline-plugins/shiftWork/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;

const SHIFT_WORK_ACTIONS = [
  "issue.comment",
  "issue.create",
  "issue.dependency.add",
  "issue.dependency.list",
  "issue.dependency.listPage",
  "issue.dependency.remove",
  "issue.get",
  "issue.list",
  "issue.listPage",
  "issue.update",
  "issueView.create",
  "issueView.delete",
  "issueView.get",
  "issueView.issues",
  "issueView.issuesPage",
  "issueView.list",
  "issueView.listPage",
  "issueView.update",
  "project.create",
  "project.get",
  "project.list",
  "project.listPage",
  "project.update",
] as const;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeShiftWork(): PluginDef {
  const { api, resolve } = createPluginAPI("shiftWork");
  shiftWork(api);
  return resolve();
}

function getAction(plugin: PluginDef, name: string) {
  const action = plugin.actions.find((a) => a.name === name);
  assert.ok(action, `expected shiftWork.${name} to be registered`);
  return action;
}

function ctx(): ActionContext {
  return {
    connection: {
      name: "shiftWork",
      plugin: "shiftWork",
      config: { apiKey: "shift_test" },
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
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("shiftWork plugin", () => {
  it("registers the work-tracking surface: projects, issues, views", () => {
    const plugin = makeShiftWork();
    assert.equal(plugin.name, "shiftWork");
    assert.deepEqual(plugin.actions.map((a) => a.name).sort(), [
      ...SHIFT_WORK_ACTIONS,
    ]);
  });

  it("strictly validates every action schema", () => {
    for (const action of makeShiftWork().actions) {
      const schema = action.inputSchema as {
        type?: string;
        additionalProperties?: boolean;
      };
      assert.equal(schema.type, "object", action.name);
      assert.equal(schema.additionalProperties, false, action.name);
    }
  });

  it("does not expose issue.report or issue lifecycle transitions in v1", () => {
    const names = new Set(makeShiftWork().actions.map((a) => a.name));
    for (const name of [
      "issue.report",
      "issue.resolve",
      "issue.close",
      "issue.reopen",
    ]) {
      assert.equal(names.has(name), false);
    }
  });

  it("creates issues with bearer auth and default organization", async () => {
    const action = getAction(makeShiftWork(), "issue.create");

    mockShift((input, init) => {
      assert.equal(String(input), "https://cloud.shift-labs.ai/v1/issues");
      assert.equal(init?.method, "POST");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer shift_test");
      assert.equal(headers.get("x-shift-org-id"), null);
      assert.deepEqual(JSON.parse(String(init?.body)), {
        title: "Broken sync",
        description: "It failed",
      });
      return { issue: { id: "issue_1", title: "Broken sync" } };
    });

    assert.deepEqual(
      await action.execute(
        { title: "Broken sync", description: "It failed" },
        ctx(),
      ),
      { id: "issue_1", title: "Broken sync" },
    );
  });

  it("exposes strict cursor pagination without breaking first-page list actions", async () => {
    const plugin = makeShiftWork();
    const page = getAction(plugin, "issue.listPage");
    assert.ok(page.inputSchema);
    assert.equal(Check(page.inputSchema as never, { limit: 25 }), true);
    assert.equal(Check(page.inputSchema as never, { limit: 2.5 }), false);
    assert.equal(Check(page.inputSchema as never, { cursor: "" }), false);

    mockShift((input) => {
      const url = new URL(String(input));
      assert.equal(url.pathname, "/v1/issues");
      assert.equal(url.searchParams.get("cursor"), "next_1");
      assert.equal(url.searchParams.get("limit"), "25");
      return { issues: [{ id: "issue_2" }], nextCursor: "next_2" };
    });

    assert.deepEqual(
      await page.execute({ cursor: "next_1", limit: 25 }, ctx()),
      { issues: [{ id: "issue_2" }], nextCursor: "next_2" },
    );
  });

  it("accepts structured Issue metadata and rejects no-op updates", () => {
    const plugin = makeShiftWork();
    const create = getAction(plugin, "issue.create");
    const update = getAction(plugin, "issue.update");
    assert.equal(
      Check(create.inputSchema as never, {
        title: "Investigate",
        metadata: { source: "monitor", attempts: 3 },
      }),
      true,
    );
    assert.equal(Check(update.inputSchema as never, { id: "issue_1" }), false);
    assert.equal(
      Check(update.inputSchema as never, { id: "issue_1", typo: true }),
      false,
    );
    assert.equal(
      Check(update.inputSchema as never, { id: "issue_1", archived: true }),
      true,
    );
    assert.equal(
      Check(create.inputSchema as never, {
        title: "Investigate",
        dueAt: "not-a-timestamp",
      }),
      false,
    );
    assert.equal(
      Check(create.inputSchema as never, {
        title: "Investigate",
        dueAt: "2026-07-14T12:00:00.000Z",
      }),
      true,
    );
    assert.equal(
      Check(create.inputSchema as never, {
        title: "Investigate",
        dueAt: "2026-07-14T15:00:00+03:00",
      }),
      false,
    );
    assert.equal(Check(create.inputSchema as never, { title: "   " }), false);
    assert.equal(
      Check(getAction(plugin, "issue.list").inputSchema as never, {
        includeArchived: true,
      }),
      true,
    );
    const createView = getAction(plugin, "issueView.create");
    assert.equal(
      Check(createView.inputSchema as never, {
        name: "Shared",
        visibility: "organization",
      }),
      true,
    );
    assert.equal(
      Check(createView.inputSchema as never, {
        name: "Orphaned",
        visibility: "personal",
      }),
      false,
    );
    assert.equal(
      Check(getAction(plugin, "issueView.get").inputSchema as never, {
        id: "",
      }),
      false,
    );
    for (const actionName of ["project.update", "issueView.update"]) {
      assert.equal(
        Check(getAction(plugin, actionName).inputSchema as never, {
          id: "resource_1",
        }),
        false,
        actionName,
      );
    }
    assert.equal(
      Check(getAction(plugin, "issueView.list").inputSchema as never, {
        createdById: "user_1",
      }),
      true,
    );
  });

  it("rejects cloud domain invariants before calling the API", async () => {
    const plugin = makeShiftWork();
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("fetch should not run");
    }) as typeof fetch;

    await assert.rejects(
      () =>
        getAction(plugin, "project.create").execute(
          {
            name: "Invalid dates",
            startAt: "2026-07-15T00:00:00.000Z",
            targetAt: "2026-07-14T00:00:00.000Z",
          },
          ctx(),
        ),
      /targetAt must not precede startAt/,
    );
    await assert.rejects(
      () =>
        getAction(plugin, "issue.dependency.add").execute(
          { blockedIssueId: "issue_1", blockingIssueId: "issue_1" },
          ctx(),
        ),
      /cannot block itself/,
    );
    await assert.rejects(
      () =>
        getAction(plugin, "issueView.create").execute(
          {
            name: "Invalid dates",
            startAfter: "2026-07-15T00:00:00.000Z",
            dueBefore: "2026-07-14T00:00:00.000Z",
          },
          ctx(),
        ),
      /dueBefore must not precede startAfter/,
    );
    assert.equal(fetchCalls, 0);
  });

  it("rejects nested Issues without a Project before calling the API", async () => {
    const action = getAction(makeShiftWork(), "issue.create");
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("fetch should not run");
    }) as typeof fetch;

    await assert.rejects(
      () =>
        action.execute({ title: "Nested", parentIssueId: "parent_1" }, ctx()),
      /projectId is required/,
    );
    assert.equal(fetchCalls, 0);
  });

  it("creates Projects, nested Issues, and saved Issue Views", async () => {
    const plugin = makeShiftWork();
    const project = getAction(plugin, "project.create");
    const issue = getAction(plugin, "issue.create");
    const view = getAction(plugin, "issueView.create");
    const calls: Array<{ url: string; body: unknown }> = [];

    mockShift((input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.endsWith("/v1/projects")) return { project: { id: "project_1" } };
      if (url.endsWith("/v1/issues")) return { issue: { id: "issue_1" } };
      if (url.endsWith("/v1/issue-views")) return { view: { id: "view_1" } };
      throw new Error(`unexpected request: ${url}`);
    });

    assert.deepEqual(await project.execute({ name: "Unified work" }, ctx()), {
      id: "project_1",
    });
    assert.deepEqual(
      await issue.execute(
        {
          title: "Sub-Issue",
          projectId: "project_1",
          parentIssueId: "parent_1",
        },
        ctx(),
      ),
      { id: "issue_1" },
    );
    assert.deepEqual(
      await view.execute(
        {
          name: "Project board",
          layout: "board",
          projectId: "project_1",
          groupBy: "status",
        },
        ctx(),
      ),
      { id: "view_1" },
    );
    assert.deepEqual(
      calls.map((call) => call.body),
      [
        { name: "Unified work" },
        {
          title: "Sub-Issue",
          projectId: "project_1",
          parentIssueId: "parent_1",
        },
        {
          name: "Project board",
          visibility: "organization",
          layout: "board",
          filters: { projectId: "project_1" },
          groupBy: "status",
          sortBy: ["updatedAt"],
        },
      ],
    );
  });

  it("adds issue comments", async () => {
    const action = getAction(makeShiftWork(), "issue.comment");

    mockShift((input, init) => {
      assert.equal(
        String(input),
        "https://cloud.shift-labs.ai/v1/issues/issue_1/comments",
      );
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { body: "Looking" });
      return { event: { id: "event_1", body: "Looking" } };
    });

    assert.deepEqual(
      await action.execute({ id: "issue_1", body: "Looking" }, ctx()),
      { id: "event_1", body: "Looking" },
    );
  });
});
