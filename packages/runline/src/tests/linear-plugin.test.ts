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

function ctx(config: Record<string, unknown> = {}): ActionContext {
  return {
    connection: {
      name: "linear",
      plugin: "linear",
      config: { apiKey: "lin_test", ...config },
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
  mockLinearSequence([assertRequest]);
}

function mockLinearSequence(
  assertions: Array<
    (body: { query: string; variables?: Record<string, unknown> }) => unknown
  >,
) {
  let i = 0;
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
    const assertRequest = assertions[i++];
    assert.ok(assertRequest, `unexpected Linear request ${i}: ${body.query}`);
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

describe("linear plugin scoped issue access", () => {
  const scopedCtx = () => ctx({ scopeLabelIds: "label-allowed" });

  it("auto-applies configured scope labels on issue.create", async () => {
    const action = getAction(makeLinear(), "issue.create");

    mockLinear((body) => {
      assert.match(body.query, /issueCreate\(input: \$input\)/);
      assert.deepEqual(body.variables?.input, {
        teamId: "team-1",
        title: "Scoped issue",
        labelIds: ["label-other", "label-allowed"],
      });
      return { issueCreate: { success: true, issue: { id: "issue-1" } } };
    });

    await action.execute(
      { teamId: "team-1", title: "Scoped issue", labelIds: ["label-other"] },
      scopedCtx(),
    );
  });

  it("injects the scope label filter on issue.list", async () => {
    const action = getAction(makeLinear(), "issue.list");

    mockLinear((body) => {
      assert.match(body.query, /issues\(/);
      assert.deepEqual(body.variables?.filter, {
        and: [
          { team: { id: { eq: "team-1" } } },
          { labels: { id: { in: ["label-allowed"] } } },
        ],
      });
      return { issues: { nodes: [], pageInfo: { hasNextPage: false } } };
    });

    await action.execute({ teamId: "team-1" }, scopedCtx());
  });

  it("rejects direct issue.get when the issue lacks the scope label", async () => {
    const action = getAction(makeLinear(), "issue.get");

    mockLinear((body) => {
      assert.match(body.query, /issue\(id: \$id\)/);
      return {
        issue: {
          id: "issue-1",
          labels: { nodes: [{ id: "label-other", name: "Other" }] },
        },
      };
    });

    await assert.rejects(
      action.execute({ issueId: "ISS-1" }, scopedCtx()),
      /not available to this scoped connection/,
    );
  });

  it("checks scope before mutating issues", async () => {
    const action = getAction(makeLinear(), "issue.delete");

    mockLinearSequence([
      (body) => {
        assert.match(body.query, /issue\(id: \$id\)/);
        assert.deepEqual(body.variables, { id: "ISS-1" });
        return {
          issue: {
            id: "issue-1",
            labels: { nodes: [{ id: "label-allowed", name: "Allowed" }] },
          },
        };
      },
      (body) => {
        assert.match(body.query, /issueDelete\(id: \$id/);
        assert.deepEqual(body.variables, { id: "ISS-1", perm: null });
        return { issueDelete: { success: true } };
      },
    ]);

    const result = await action.execute({ issueId: "ISS-1" }, scopedCtx());
    assert.deepEqual(result, { success: true });
  });

  it("refuses to remove a required scope label", async () => {
    const action = getAction(makeLinear(), "issue.removeLabel");

    mockLinear((body) => {
      assert.match(body.query, /issue\(id: \$id\)/);
      return {
        issue: {
          id: "issue-1",
          labels: { nodes: [{ id: "label-allowed", name: "Allowed" }] },
        },
      };
    });

    await assert.rejects(
      action.execute(
        { issueId: "ISS-1", labelId: "label-allowed" },
        scopedCtx(),
      ),
      /Cannot remove a required Linear scope label/,
    );
  });

  it("disables workspace-wide comment listing under scoped config", async () => {
    const action = getAction(makeLinear(), "comment.list");

    await assert.rejects(
      action.execute({}, scopedCtx()),
      /comment.list is not available to scoped Linear connections/,
    );
  });

  it("blocks broad non-ticket surfaces under scoped config", async () => {
    for (const name of [
      "project.list",
      "project.get",
      "user.list",
      "org.get",
      "webhook.list",
    ] as const) {
      const action = getAction(makeLinear(), name);
      await assert.rejects(
        action.execute({ id: "x" }, scopedCtx()),
        /not available to scoped Linear connections/,
      );
    }
  });

  it("injects the scope label filter on issue.search with caller filters", async () => {
    const action = getAction(makeLinear(), "issue.search");

    mockLinear((body) => {
      assert.match(body.query, /searchIssues/);
      assert.deepEqual(body.variables?.filter, {
        and: [
          { state: { type: { eq: "started" } } },
          { labels: { id: { in: ["label-allowed"] } } },
        ],
      });
      return {
        searchIssues: {
          nodes: [],
          totalCount: 0,
          pageInfo: { hasNextPage: false },
        },
      };
    });

    await action.execute(
      { term: "bug", filter: { state: { type: { eq: "started" } } } },
      scopedCtx(),
    );
  });

  it("preserves scope labels when issue.update replaces labelIds", async () => {
    const action = getAction(makeLinear(), "issue.update");

    mockLinearSequence([
      (body) => {
        assert.match(body.query, /issue\(id: \$id\)/);
        return {
          issue: {
            id: "issue-1",
            labels: { nodes: [{ id: "label-allowed", name: "Allowed" }] },
          },
        };
      },
      (body) => {
        assert.match(body.query, /issueUpdate\(id: \$id, input: \$input\)/);
        assert.deepEqual(body.variables?.input, {
          title: "Updated",
          labelIds: ["label-other", "label-allowed"],
        });
        return { issueUpdate: { success: true, issue: { id: "issue-1" } } };
      },
    ]);

    await action.execute(
      { issueId: "ISS-1", title: "Updated", labelIds: ["label-other"] },
      scopedCtx(),
    );
  });

  it("rejects issue.update attempts to remove a scope label", async () => {
    const action = getAction(makeLinear(), "issue.update");

    mockLinear((body) => {
      assert.match(body.query, /issue\(id: \$id\)/);
      return {
        issue: {
          id: "issue-1",
          labels: { nodes: [{ id: "label-allowed", name: "Allowed" }] },
        },
      };
    });

    await assert.rejects(
      action.execute(
        { issueId: "ISS-1", removedLabelIds: ["label-allowed"] },
        scopedCtx(),
      ),
      /Cannot remove a required Linear scope label/,
    );
  });

  it("checks parent issue scope before adding comments or listing comments", async () => {
    const addComment = getAction(makeLinear(), "issue.addComment");
    const listComments = getAction(makeLinear(), "issue.listComments");

    mockLinearSequence([
      (body) => {
        assert.match(body.query, /issue\(id: \$id\)/);
        return {
          issue: {
            id: "issue-1",
            labels: { nodes: [{ id: "label-allowed", name: "Allowed" }] },
          },
        };
      },
      (body) => {
        assert.match(body.query, /commentCreate\(input: \$input\)/);
        return {
          commentCreate: { success: true, comment: { id: "comment-1" } },
        };
      },
      (body) => {
        assert.match(body.query, /issue\(id: \$id\)/);
        return {
          issue: {
            id: "issue-1",
            labels: { nodes: [{ id: "label-allowed", name: "Allowed" }] },
          },
        };
      },
      (body) => {
        assert.match(body.query, /comments\(first: \$first\)/);
        return { issue: { comments: { nodes: [{ id: "comment-1" }] } } };
      },
    ]);

    assert.deepEqual(
      await addComment.execute({ issueId: "ISS-1", body: "hi" }, scopedCtx()),
      { id: "comment-1" },
    );
    assert.deepEqual(
      await listComments.execute({ issueId: "ISS-1" }, scopedCtx()),
      [{ id: "comment-1" }],
    );
  });

  it("checks parent issue scope before attachment create/link actions", async () => {
    const create = getAction(makeLinear(), "attachment.create");
    const link = getAction(makeLinear(), "attachment.linkURL");

    mockLinearSequence([
      (body) => {
        assert.match(body.query, /issue\(id: \$id\)/);
        return {
          issue: {
            id: "issue-1",
            labels: { nodes: [{ id: "label-allowed", name: "Allowed" }] },
          },
        };
      },
      (body) => {
        assert.match(body.query, /attachmentCreate\(input: \$input\)/);
        return {
          attachmentCreate: { success: true, attachment: { id: "att-1" } },
        };
      },
      (body) => {
        assert.match(body.query, /issue\(id: \$id\)/);
        return {
          issue: {
            id: "issue-1",
            labels: { nodes: [{ id: "label-allowed", name: "Allowed" }] },
          },
        };
      },
      (body) => {
        assert.match(body.query, /attachmentLinkURL/);
        return {
          attachmentLinkURL: { success: true, attachment: { id: "att-2" } },
        };
      },
    ]);

    assert.deepEqual(
      await create.execute(
        { issueId: "ISS-1", title: "Trace", url: "https://example.test" },
        scopedCtx(),
      ),
      { id: "att-1" },
    );
    assert.deepEqual(
      await link.execute(
        { issueId: "ISS-1", url: "https://example.test" },
        scopedCtx(),
      ),
      { id: "att-2" },
    );
  });

  it("allows direct comment actions only through scoped parent issues", async () => {
    const get = getAction(makeLinear(), "comment.get");
    const update = getAction(makeLinear(), "comment.update");
    const del = getAction(makeLinear(), "comment.delete");

    mockLinearSequence([
      (body) => {
        assert.match(body.query, /comment\(id: \$id\).*issue/s);
        return {
          comment: {
            id: "comment-1",
            issue: { labels: { nodes: [{ id: "label-allowed" }] } },
          },
        };
      },
      (body) => {
        assert.match(body.query, /comment\(id: \$id\) \{ id body url/s);
        return { comment: { id: "comment-1", body: "hi" } };
      },
      (body) => {
        assert.match(body.query, /comment\(id: \$id\).*issue/s);
        return {
          comment: {
            id: "comment-1",
            issue: { labels: { nodes: [{ id: "label-allowed" }] } },
          },
        };
      },
      (body) => {
        assert.match(body.query, /commentUpdate\(id: \$id, input: \$input\)/);
        return {
          commentUpdate: { success: true, comment: { id: "comment-1" } },
        };
      },
      (body) => {
        assert.match(body.query, /comment\(id: \$id\).*issue/s);
        return {
          comment: {
            id: "comment-1",
            issue: { labels: { nodes: [{ id: "label-allowed" }] } },
          },
        };
      },
      (body) => {
        assert.match(body.query, /commentDelete\(id: \$id\)/);
        return { commentDelete: { success: true } };
      },
    ]);

    assert.deepEqual(await get.execute({ id: "comment-1" }, scopedCtx()), {
      id: "comment-1",
      body: "hi",
    });
    assert.deepEqual(
      await update.execute({ id: "comment-1", body: "updated" }, scopedCtx()),
      { id: "comment-1" },
    );
    assert.deepEqual(await del.execute({ id: "comment-1" }, scopedCtx()), {
      success: true,
    });
  });

  it("rejects direct comment actions when the parent issue is out of scope", async () => {
    const action = getAction(makeLinear(), "comment.get");

    mockLinear((body) => {
      assert.match(body.query, /comment\(id: \$id\).*issue/s);
      return {
        comment: {
          id: "comment-1",
          issue: { labels: { nodes: [{ id: "label-other" }] } },
        },
      };
    });

    await assert.rejects(
      action.execute({ id: "comment-1" }, scopedCtx()),
      /Linear comment is not available/,
    );
  });

  it("allows direct attachment actions only through scoped parent issues", async () => {
    const get = getAction(makeLinear(), "attachment.get");
    const update = getAction(makeLinear(), "attachment.update");
    const del = getAction(makeLinear(), "attachment.delete");

    mockLinearSequence([
      (body) => {
        assert.match(body.query, /attachment\(id: \$id\).*issue/s);
        return {
          attachment: {
            id: "att-1",
            issue: { labels: { nodes: [{ id: "label-allowed" }] } },
          },
        };
      },
      (body) => {
        assert.match(body.query, /attachment\(id: \$id\) \{ id title/s);
        return { attachment: { id: "att-1", title: "Trace" } };
      },
      (body) => {
        assert.match(body.query, /attachment\(id: \$id\).*issue/s);
        return {
          attachment: {
            id: "att-1",
            issue: { labels: { nodes: [{ id: "label-allowed" }] } },
          },
        };
      },
      (body) => {
        assert.match(
          body.query,
          /attachmentUpdate\(id: \$id, input: \$input\)/,
        );
        return {
          attachmentUpdate: { success: true, attachment: { id: "att-1" } },
        };
      },
      (body) => {
        assert.match(body.query, /attachment\(id: \$id\).*issue/s);
        return {
          attachment: {
            id: "att-1",
            issue: { labels: { nodes: [{ id: "label-allowed" }] } },
          },
        };
      },
      (body) => {
        assert.match(body.query, /attachmentDelete\(id: \$id\)/);
        return { attachmentDelete: { success: true } };
      },
    ]);

    assert.deepEqual(await get.execute({ id: "att-1" }, scopedCtx()), {
      id: "att-1",
      title: "Trace",
    });
    assert.deepEqual(
      await update.execute({ id: "att-1", title: "Updated" }, scopedCtx()),
      { id: "att-1" },
    );
    assert.deepEqual(await del.execute({ id: "att-1" }, scopedCtx()), {
      success: true,
    });
  });

  it("rejects direct attachment actions when the parent issue is out of scope", async () => {
    const action = getAction(makeLinear(), "attachment.get");

    mockLinear((body) => {
      assert.match(body.query, /attachment\(id: \$id\).*issue/s);
      return {
        attachment: {
          id: "att-1",
          issue: { labels: { nodes: [{ id: "label-other" }] } },
        },
      };
    });

    await assert.rejects(
      action.execute({ id: "att-1" }, scopedCtx()),
      /Linear attachment is not available/,
    );
  });

  it("scopes view.issues and blocks other view connection surfaces", async () => {
    const issues = getAction(makeLinear(), "view.issues");

    mockLinear((body) => {
      assert.match(body.query, /customView\(id: \$id\)/);
      assert.deepEqual(body.variables?.filter, {
        labels: { id: { in: ["label-allowed"] } },
      });
      return {
        customView: {
          issues: { nodes: [], pageInfo: { hasNextPage: false } },
        },
      };
    });

    await issues.execute({ viewId: "view-1" }, scopedCtx());

    for (const name of [
      "view.projects",
      "view.initiatives",
      "view.updates",
    ] as const) {
      const action = getAction(makeLinear(), name);
      await assert.rejects(
        action.execute({ viewId: "view-1" }, scopedCtx()),
        /not available to scoped Linear connections/,
      );
    }
  });

  it("keeps broad surfaces available when scope labels are not configured", async () => {
    const action = getAction(makeLinear(), "project.list");

    mockLinear((body) => {
      assert.match(body.query, /projects\(/);
      return { projects: { nodes: [], pageInfo: { hasNextPage: false } } };
    });

    assert.deepEqual(await action.execute({}, ctx()), {
      nodes: [],
      pageInfo: { hasNextPage: false },
    });
  });
});
