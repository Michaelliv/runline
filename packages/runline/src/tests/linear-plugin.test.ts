import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import linear from "../../../runline-plugins/linear/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;

const LINEAR_ACTIONS = [
  "attachment.create",
  "attachment.delete",
  "attachment.get",
  "attachment.linkURL",
  "attachment.list",
  "attachment.update",
  "comment.delete",
  "comment.get",
  "comment.list",
  "comment.update",
  "cycle.create",
  "cycle.get",
  "cycle.list",
  "cycle.update",
  "initiative.addProject",
  "initiative.create",
  "initiative.delete",
  "initiative.get",
  "initiative.list",
  "initiative.removeProject",
  "initiative.update",
  "issue.addComment",
  "issue.addLabel",
  "issue.addLink",
  "issue.archive",
  "issue.create",
  "issue.delete",
  "issue.get",
  "issue.list",
  "issue.listComments",
  "issue.removeLabel",
  "issue.search",
  "issue.subscribe",
  "issue.unarchive",
  "issue.unsubscribe",
  "issue.update",
  "label.create",
  "label.delete",
  "label.get",
  "label.list",
  "label.restore",
  "label.retire",
  "label.update",
  "milestone.create",
  "milestone.delete",
  "milestone.get",
  "milestone.list",
  "milestone.update",
  "org.get",
  "project.create",
  "project.delete",
  "project.get",
  "project.list",
  "project.search",
  "project.unarchive",
  "project.update",
  "projectUpdate.archive",
  "projectUpdate.create",
  "projectUpdate.list",
  "projectUpdate.update",
  "state.create",
  "state.get",
  "state.list",
  "state.update",
  "team.create",
  "team.get",
  "team.list",
  "team.members",
  "team.update",
  "user.get",
  "user.list",
  "user.me",
  "user.update",
  "view.create",
  "view.delete",
  "view.get",
  "view.initiatives",
  "view.issues",
  "view.list",
  "view.projects",
  "view.update",
  "view.updates",
  "webhook.create",
  "webhook.delete",
  "webhook.get",
  "webhook.list",
  "webhook.rotateSecret",
  "webhook.update",
] as const;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeLinear(): PluginDef {
  const { api, resolve } = createPluginAPI("linear");
  linear(api);
  return resolve();
}

function getAction(plugin: PluginDef, name: string) {
  const action = plugin.actions.find((a) => a.name === name);
  assert.ok(action, `expected linear.${name} to be registered`);
  return action;
}

function ctx(): ActionContext {
  return {
    connection: {
      name: "linear",
      plugin: "linear",
      config: { apiKey: "lin_test" },
    },
    log: {
      info() {},
      warn() {},
      error() {},
    },
    async updateConnection() {},
  };
}

function mockLinear(
  assertRequest: (body: {
    query: string;
    variables?: Record<string, unknown>;
  }) => unknown,
) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "https://api.linear.app/graphql");
    assert.equal(init?.method, "POST");
    assert.equal(
      init?.headers?.["Authorization" as keyof HeadersInit],
      "lin_test",
    );

    const body = JSON.parse(String(init?.body)) as {
      query: string;
      variables?: Record<string, unknown>;
    };
    const data = assertRequest(body);

    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("linear plugin action surface", () => {
  it("registers the expected public actions", () => {
    const plugin = makeLinear();
    const actions = plugin.actions.map((a) => a.name).sort();
    assert.deepEqual(actions, [...LINEAR_ACTIONS]);
  });

  it("does not expose duplicate comment creation aliases", () => {
    const plugin = makeLinear();
    assert.ok(plugin.actions.some((a) => a.name === "issue.addComment"));
    assert.ok(!plugin.actions.some((a) => a.name === "comment.create"));
  });
});

describe("linear plugin comment actions", () => {
  it("issue.addComment calls Linear's commentCreate mutation", async () => {
    const action = getAction(makeLinear(), "issue.addComment");

    mockLinear((body) => {
      assert.match(body.query, /commentCreate\(input: \$input\)/);
      assert.deepEqual(body.variables, {
        input: {
          issueId: "THE-123",
          body: "Resolved by PR #123.",
        },
      });
      return {
        commentCreate: {
          success: true,
          comment: {
            id: "comment-1",
            body: "Resolved by PR #123.",
            issue: { id: "issue-1", identifier: "THE-123" },
          },
        },
      };
    });

    const result = await action.execute(
      { issueId: "THE-123", body: "Resolved by PR #123." },
      ctx(),
    );

    assert.deepEqual(result, {
      id: "comment-1",
      body: "Resolved by PR #123.",
      issue: { id: "issue-1", identifier: "THE-123" },
    });
  });

  it("comment.update calls Linear's commentUpdate mutation", async () => {
    const action = getAction(makeLinear(), "comment.update");

    mockLinear((body) => {
      assert.match(body.query, /commentUpdate\(id: \$id, input: \$input\)/);
      assert.deepEqual(body.variables, {
        id: "comment-1",
        input: { body: "Updated note" },
      });
      return {
        commentUpdate: {
          success: true,
          comment: { id: "comment-1", body: "Updated note" },
        },
      };
    });

    const result = await action.execute(
      { id: "comment-1", body: "Updated note" },
      ctx(),
    );

    assert.deepEqual(result, { id: "comment-1", body: "Updated note" });
  });

  it("comment.delete calls Linear's commentDelete mutation", async () => {
    const action = getAction(makeLinear(), "comment.delete");

    mockLinear((body) => {
      assert.match(body.query, /commentDelete\(id: \$id\)/);
      assert.deepEqual(body.variables, { id: "comment-1" });
      return { commentDelete: { success: true } };
    });

    const result = await action.execute({ id: "comment-1" }, ctx());

    assert.deepEqual(result, { success: true });
  });
});
