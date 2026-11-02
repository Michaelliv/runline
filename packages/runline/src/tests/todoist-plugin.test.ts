import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import todoist from "../../../runline-plugins/todoist/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import { validateTypedInput } from "../plugin/schema.js";
import type { ActionContext, TypedInputSchema } from "../plugin/types.js";
import { getAction, stubFetch } from "./helpers/plugin.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const { api, resolve } = createPluginAPI("todoist");
todoist(api);
const plugin = resolve();

const ctx: ActionContext = {
  connection: {
    name: "todoist",
    plugin: "todoist",
    config: { apiToken: "token" },
  },
  log: { info() {}, warn() {}, error() {} },
  async updateConnection() {},
};

async function run(name: string, input: unknown) {
  return getAction(plugin, name).execute(input, ctx);
}
/** The engine's verdict on an input, normalization included. */
function valid(name: string, input: unknown) {
  return validateTypedInput(
    getAction(plugin, name).inputSchema as TypedInputSchema,
    input,
  ).ok;
}

type Seen = { method: string; url: URL; body?: unknown; init: RequestInit };
function capture(reply: (url: URL) => Response = () => Response.json({})) {
  const seen: Seen[] = [];
  stubFetch(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    seen.push({
      method: init?.method ?? "GET",
      url: u,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      init: init ?? {},
    });
    return reply(u);
  });
  return seen;
}
const page = (results: unknown[] = []) =>
  Response.json({ results, next_cursor: null });

// Each action's input, method, path beneath /api/v1/ and JSON body.
const routes: Array<
  [string, Record<string, unknown>, string, string, unknown?]
> = [
  [
    "task.create",
    {
      content: "Pay rent",
      projectId: "p1",
      priority: 4,
      dueDate: "2026-05-01",
      labels: ["home"],
      assigneeId: "123",
    },
    "POST",
    "tasks",
    {
      content: "Pay rent",
      project_id: "p1",
      priority: 4,
      due_date: "2026-05-01",
      labels: ["home"],
      assignee_id: 123,
    },
  ],
  ["task.get", { id: "t1" }, "GET", "tasks/t1"],
  ["task.list", {}, "GET", "tasks"],
  [
    "task.update",
    { id: "t1", description: "" },
    "POST",
    "tasks/t1",
    { description: "" },
  ],
  ["task.close", { id: "t1" }, "POST", "tasks/t1/close"],
  ["task.reopen", { id: "t1" }, "POST", "tasks/t1/reopen"],
  ["task.delete", { id: "t1" }, "DELETE", "tasks/t1"],
  [
    "task.quickAdd",
    { text: "Buy milk tomorrow", autoReminder: true },
    "POST",
    "tasks/quick",
    { text: "Buy milk tomorrow", auto_reminder: true },
  ],
  [
    "task.move",
    { id: "t1", sectionId: "s1" },
    "POST",
    "tasks/t1/move",
    { section_id: "s1" },
  ],
  [
    "task.listCompleted",
    { since: "2026-05-01T00:00:00Z", until: "2026-05-08T00:00:00Z" },
    "GET",
    "tasks/completed/by_completion_date",
  ],
  [
    "project.create",
    { name: "Home", color: "sky_blue", viewStyle: "board" },
    "POST",
    "projects",
    { name: "Home", color: "sky_blue", view_style: "board" },
  ],
  ["project.get", { id: "p1" }, "GET", "projects/p1"],
  ["project.list", {}, "GET", "projects"],
  [
    "project.update",
    { id: "p1", isFavorite: false },
    "POST",
    "projects/p1",
    { is_favorite: false },
  ],
  ["project.delete", { id: "p1" }, "DELETE", "projects/p1"],
  ["project.archive", { id: "p1" }, "POST", "projects/p1/archive"],
  ["project.unarchive", { id: "p1" }, "POST", "projects/p1/unarchive"],
  [
    "project.getCollaborators",
    { id: "p1" },
    "GET",
    "projects/p1/collaborators",
  ],
  [
    "section.create",
    { projectId: "p1", name: "Next", order: 0 },
    "POST",
    "sections",
    { project_id: "p1", name: "Next", order: 0 },
  ],
  ["section.get", { id: "s1" }, "GET", "sections/s1"],
  ["section.list", { projectId: "p1" }, "GET", "sections"],
  [
    "section.update",
    { id: "s1", name: "Later" },
    "POST",
    "sections/s1",
    { name: "Later" },
  ],
  ["section.delete", { id: "s1" }, "DELETE", "sections/s1"],
  [
    "comment.create",
    { projectId: "p1", content: "hi" },
    "POST",
    "comments",
    { project_id: "p1", content: "hi" },
  ],
  ["comment.get", { id: "c1" }, "GET", "comments/c1"],
  ["comment.list", { taskId: "t1" }, "GET", "comments"],
  [
    "comment.update",
    { id: "c1", content: "edit" },
    "POST",
    "comments/c1",
    { content: "edit" },
  ],
  ["comment.delete", { id: "c1" }, "DELETE", "comments/c1"],
  [
    "label.create",
    { name: "home", isFavorite: true },
    "POST",
    "labels",
    { name: "home", is_favorite: true },
  ],
  ["label.get", { id: "l1" }, "GET", "labels/l1"],
  ["label.list", {}, "GET", "labels"],
  ["label.update", { id: "l1", order: 0 }, "POST", "labels/l1", { order: 0 }],
  ["label.delete", { id: "l1" }, "DELETE", "labels/l1"],
];

describe("todoist routes (API v1)", () => {
  it("covers every registered action", () => {
    assert.deepEqual(
      routes.map(([name]) => name).sort(),
      plugin.actions.map((a) => a.name).sort(),
    );
  });

  for (const [name, input, method, path, body] of routes)
    it(`${name} → ${method} ${path}`, async () => {
      assert.ok(valid(name, input), "input should validate");
      const seen = capture((url) =>
        url.pathname.includes("completed")
          ? Response.json({ items: [] })
          : page(),
      );
      await run(name, input);
      assert.equal(seen.length, 1);
      assert.equal(seen[0].method, method);
      assert.equal(
        seen[0].url.origin + seen[0].url.pathname,
        `https://api.todoist.com/api/v1/${path}`,
      );
      assert.deepEqual(seen[0].body, body);
      assert.equal(
        new Headers(seen[0].init.headers).get("authorization"),
        "Bearer token",
      );
    });

  it("acknowledges writes that answer with no body", async () => {
    capture(() => new Response(null, { status: 204 }));
    assert.deepEqual(await run("task.delete", { id: "t1" }), { success: true });
  });
});

describe("todoist lists", () => {
  it("follows next_cursor and answers a flat array", async () => {
    const seen = capture((url) =>
      url.searchParams.get("cursor")
        ? page([{ id: "b" }])
        : Response.json({ results: [{ id: "a" }], next_cursor: "c1" }),
    );
    assert.deepEqual(await run("task.list", { projectId: "p1" }), [
      { id: "a" },
      { id: "b" },
    ]);
    assert.equal(seen[0].url.searchParams.get("project_id"), "p1");
    assert.equal(seen[0].url.searchParams.get("limit"), "200");
    assert.equal(seen[0].url.searchParams.has("cursor"), false);
    assert.equal(seen[1].url.searchParams.get("cursor"), "c1");
  });

  it("stops paging once limit items are in", async () => {
    const seen = capture(() =>
      Response.json({
        results: [{ id: "a" }, { id: "b" }],
        next_cursor: "more",
      }),
    );
    assert.deepEqual(await run("task.list", { limit: 2 }), [
      { id: "a" },
      { id: "b" },
    ]);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url.searchParams.get("limit"), "2");
  });

  it("sends a filter query to tasks/filter instead of the selectors", async () => {
    const seen = capture(() => page());
    await run("task.list", { filter: "today | overdue", lang: "en" });
    assert.ok(seen[0].url.pathname.endsWith("/api/v1/tasks/filter"));
    assert.equal(seen[0].url.searchParams.get("query"), "today | overdue");
    assert.equal(seen[0].url.searchParams.get("lang"), "en");
    assert.equal(
      valid("task.list", { filter: "today", projectId: "p1" }),
      false,
    );
    assert.equal(valid("task.list", { filter: "today", label: "x" }), false);
    assert.equal(valid("task.list", { lang: "en" }), false);
  });

  it("lists completed tasks from items, filtered by a query", async () => {
    const seen = capture(() =>
      Response.json({ items: [{ id: "done" }], next_cursor: null }),
    );
    assert.deepEqual(
      await run("task.listCompleted", {
        since: "2026-05-01T00:00:00Z",
        until: "2026-05-08T00:00:00Z",
        filter: "#Work",
        lang: "en",
      }),
      [{ id: "done" }],
    );
    const q = seen[0].url.searchParams;
    assert.equal(q.get("since"), "2026-05-01T00:00:00Z");
    assert.equal(q.get("until"), "2026-05-08T00:00:00Z");
    assert.equal(q.get("filter_query"), "#Work");
    assert.equal(q.get("filter_lang"), "en");
    const window = {
      since: "2026-05-01T00:00:00Z",
      until: "2026-05-08T00:00:00Z",
    };
    assert.equal(
      valid("task.listCompleted", { ...window, since: "last week" }),
      false,
    );
    assert.equal(valid("task.listCompleted", { ...window, lang: "en" }), false);
  });
});

describe("todoist inputs", () => {
  it("moves a task to exactly one destination", () => {
    assert.equal(valid("task.move", { id: "t1" }), false);
    assert.equal(
      valid("task.move", { id: "t1", projectId: "p", sectionId: "s" }),
      false,
    );
  });

  it("comments on a task or a project, never both or neither", () => {
    assert.equal(valid("comment.create", { content: "hi" }), false);
    assert.equal(
      valid("comment.create", { taskId: "t", projectId: "p", content: "hi" }),
      false,
    );
    assert.equal(valid("comment.list", {}), false);
  });

  it("asks an update for a change", () => {
    for (const name of ["task.update", "project.update", "label.update"])
      assert.equal(valid(name, { id: "x" }), false, name);
  });

  it("holds priority, dates, colors and assignees to API v1's values", () => {
    const task = { content: "x" };
    assert.equal(valid("task.create", { ...task, priority: 5 }), false);
    assert.equal(valid("task.create", { ...task, dueDate: "May 1" }), false);
    assert.equal(valid("task.create", { ...task, labels: "home" }), false);
    assert.equal(valid("task.create", { ...task, assigneeId: "me" }), false);
    assert.equal(valid("project.create", { name: "x", color: "pink" }), false);
    assert.equal(
      valid("project.create", { name: "x", viewStyle: "grid" }),
      false,
    );
    assert.equal(valid("task.get", { id: "t1", extra: 1 }), false);
    assert.equal(
      valid("task.list", { filter: "x".repeat(1025) }),
      false,
      "filter queries are at most 1024 characters",
    );
  });

  it("takes label and section positions as the API bounds them", () => {
    assert.equal(valid("label.create", { name: "x", order: -1 }), true);
    assert.equal(valid("label.create", { name: "x", order: 32768 }), false);
    assert.equal(
      valid("section.create", { projectId: "p", name: "x", order: -1 }),
      true,
    );
  });

  it("refuses an id that is not one path segment before any request", async () => {
    const seen = capture();
    await assert.rejects(run("task.get", { id: "../projects" }), {
      code: "request_not_allowed",
    });
    assert.equal(seen.length, 0);
  });
});

describe("todoist failures", () => {
  it("reports Todoist's error_tag and never its message", async () => {
    capture(() =>
      Response.json(
        {
          error: "Task not found",
          error_code: 478,
          error_extra: { event_id: "e" },
          error_tag: "NOT_FOUND",
          http_code: 404,
        },
        { status: 404 },
      ),
    );
    await assert.rejects(run("task.get", { id: "t1" }), {
      message: "todoist: request failed (HTTP 404 NOT_FOUND)",
    });
  });
});
