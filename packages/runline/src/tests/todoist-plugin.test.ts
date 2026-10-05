import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import todoist from "../../../runline-plugins/todoist/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Seen = { method: string; url: URL; body?: unknown };

function capture(reply: (url: URL) => unknown = () => ({})) {
  const seen: Seen[] = [];
  globalThis.fetch = (async (url, init) => {
    const u = new URL(String(url));
    seen.push({
      method: init?.method ?? "GET",
      url: u,
      body: init?.body
        ? JSON.parse(new TextDecoder().decode(init.body as Uint8Array))
        : undefined,
    });
    const answer = reply(u);
    return answer === null
      ? new Response(null, { status: 204 })
      : Response.json(answer);
  }) as typeof fetch;
  return seen;
}

function run(name: string, input: Record<string, unknown>) {
  const { api, resolve } = createPluginAPI("todoist");
  todoist(api);
  const found = resolve().actions.find((a) => a.name === name);
  assert.ok(found, name);
  const ctx: ActionContext = {
    connection: {
      name: "todoist",
      plugin: "todoist",
      config: { apiToken: "token" },
    },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
  return Promise.resolve(found.execute(input, ctx));
}

describe("todoist (API v1)", () => {
  it("follows next_cursor and answers a flat array", async () => {
    const seen = capture((url) =>
      url.searchParams.get("cursor")
        ? { results: [{ id: "b" }], next_cursor: null }
        : { results: [{ id: "a" }], next_cursor: "c1" },
    );
    assert.deepEqual(await run("task.list", { projectId: "p1" }), [
      { id: "a" },
      { id: "b" },
    ]);
    assert.equal(
      seen[0].url.origin + seen[0].url.pathname,
      "https://api.todoist.com/api/v1/tasks",
    );
    assert.equal(seen[0].url.searchParams.get("project_id"), "p1");
    assert.equal(seen[0].url.searchParams.get("limit"), "200");
    assert.equal(seen[1].url.searchParams.get("cursor"), "c1");
  });

  it("stops paging once limit items are in", async () => {
    const seen = capture(() => ({
      results: [{ id: "a" }, { id: "b" }],
      next_cursor: "more",
    }));
    assert.deepEqual(await run("task.list", { limit: 2 }), [
      { id: "a" },
      { id: "b" },
    ]);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url.searchParams.get("limit"), "2");
  });

  it("sends a filter query to tasks/filter and refuses mixing it", async () => {
    const seen = capture(() => ({ results: [], next_cursor: null }));
    await run("task.list", { filter: "today | overdue" });
    assert.ok(seen[0].url.pathname.endsWith("/api/v1/tasks/filter"));
    assert.equal(seen[0].url.searchParams.get("query"), "today | overdue");
    await assert.rejects(
      run("task.list", { filter: "today", projectId: "p1" }),
      /cannot be combined/,
    );
  });

  it("quick-adds through tasks/quick", async () => {
    const seen = capture(() => ({ id: "t1" }));
    await run("task.quickAdd", {
      text: "Buy milk tomorrow",
      autoReminder: true,
    });
    assert.equal(seen[0].method, "POST");
    assert.ok(seen[0].url.pathname.endsWith("/api/v1/tasks/quick"));
    assert.deepEqual(seen[0].body, {
      text: "Buy milk tomorrow",
      auto_reminder: true,
    });
  });

  it("moves a task to exactly one destination", async () => {
    const seen = capture(() => ({ id: "t1" }));
    await run("task.move", { id: "t1", sectionId: "s1" });
    assert.ok(seen[0].url.pathname.endsWith("/api/v1/tasks/t1/move"));
    assert.deepEqual(seen[0].body, { section_id: "s1" });
    await assert.rejects(
      run("task.move", { id: "t1", projectId: "p", sectionId: "s" }),
      /exactly one/,
    );
  });

  it("lists completed tasks from items", async () => {
    const seen = capture(() => ({
      items: [{ id: "done" }],
      next_cursor: null,
    }));
    assert.deepEqual(
      await run("task.listCompleted", {
        since: "2026-05-01T00:00:00Z",
        until: "2026-05-08T00:00:00Z",
        filter: "#Work",
      }),
      [{ id: "done" }],
    );
    const q = seen[0].url.searchParams;
    assert.ok(
      seen[0].url.pathname.endsWith("/tasks/completed/by_completion_date"),
    );
    assert.equal(q.get("since"), "2026-05-01T00:00:00Z");
    assert.equal(q.get("filter_query"), "#Work");
  });

  it("comments on a task or a project, never both or neither", async () => {
    const seen = capture(() => ({ id: "c1" }));
    await run("comment.create", { projectId: "p1", content: "hi" });
    assert.deepEqual(seen[0].body, { project_id: "p1", content: "hi" });
    await assert.rejects(
      run("comment.create", { content: "hi" }),
      /exactly one/,
    );
    await assert.rejects(run("comment.list", {}), /exactly one/);
  });

  it("closes a task", async () => {
    const seen = capture(() => null);
    assert.deepEqual(await run("task.close", { id: "t1" }), { success: true });
    assert.ok(seen[0].url.pathname.endsWith("/api/v1/tasks/t1/close"));
  });
});
