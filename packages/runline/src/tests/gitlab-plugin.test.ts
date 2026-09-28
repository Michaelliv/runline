import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import gitlab from "../../../runline-plugins/gitlab/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function run(action: string, input: Record<string, unknown>) {
  const { api, resolve } = createPluginAPI("gitlab");
  gitlab(api);
  const found = resolve().actions.find((a) => a.name === action);
  assert.ok(found);
  const ctx: ActionContext = {
    connection: { name: "gl", plugin: "gitlab", config: { token: "glpat" } },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
  return Promise.resolve(found.execute(input, ctx));
}

function capture() {
  const seen: Array<{ url: string; method?: string; body?: unknown }> = [];
  globalThis.fetch = (async (url, init) => {
    seen.push({
      url: String(url),
      method: init?.method,
      body: init?.body
        ? JSON.parse(new TextDecoder().decode(init.body as Uint8Array))
        : undefined,
    });
    return Response.json({});
  }) as typeof fetch;
  return seen;
}

describe("gitlab", () => {
  it("deletes a file with the branch and commit message GitLab requires in the body", async () => {
    const seen = capture();
    await run("file.delete", {
      owner: "group/sub",
      repo: "proj",
      filePath: "docs/a.md",
      branch: "main",
      commitMessage: "remove",
    });
    assert.deepEqual(seen, [
      {
        url: "https://gitlab.com/api/v4/projects/group%2Fsub%2Fproj/repository/files/docs%2Fa.md",
        method: "DELETE",
        body: { branch: "main", commit_message: "remove" },
      },
    ]);
  });

  it("addresses a slashed tag as one encoded segment", async () => {
    const seen = capture();
    await run("release.get", {
      projectId: "group/proj",
      tagName: "release/1.0",
    });
    assert.equal(
      seen[0].url,
      "https://gitlab.com/api/v4/projects/group%2Fproj/releases/release%2F1.0",
    );
  });
});
