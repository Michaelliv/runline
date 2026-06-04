import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import linear from "../../../runline-plugins/linear/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;

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

describe("linear plugin comment actions", () => {
  it("registers comment.create", () => {
    const plugin = makeLinear();
    assert.ok(plugin.actions.some((a) => a.name === "comment.create"));
  });

  it("comment.create calls Linear's commentCreate mutation", async () => {
    const action = getAction(makeLinear(), "comment.create");

    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      assert.equal(String(input), "https://api.linear.app/graphql");
      assert.equal(init?.method, "POST");
      assert.equal(
        init?.headers?.["Authorization" as keyof HeadersInit],
        "lin_test",
      );

      const body = JSON.parse(String(init?.body)) as {
        query: string;
        variables: { input: Record<string, unknown> };
      };
      assert.match(body.query, /commentCreate\(input: \$input\)/);
      assert.deepEqual(body.variables.input, {
        issueId: "THE-123",
        body: "Resolved by PR #123.",
      });

      return new Response(
        JSON.stringify({
          data: {
            commentCreate: {
              success: true,
              comment: {
                id: "comment-1",
                body: "Resolved by PR #123.",
                issue: { id: "issue-1", identifier: "THE-123" },
              },
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

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
});
