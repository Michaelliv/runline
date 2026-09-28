import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import ghost from "../../../runline-plugins/ghost/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function run(action: string, input: Record<string, unknown>) {
  const { api, resolve } = createPluginAPI("ghost");
  ghost(api);
  const found = resolve().actions.find((a) => a.name === action);
  assert.ok(found);
  const ctx: ActionContext = {
    connection: {
      name: "g",
      plugin: "ghost",
      config: {
        url: "https://blog.example.com/",
        adminApiKey: "kid1:00ff10ab",
      },
    },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
  return Promise.resolve(found.execute(input, ctx));
}

describe("ghost", () => {
  it("signs every request with a fresh Admin API JWT on the unversioned admin base", async () => {
    const seen: Array<{ url: string; method?: string; auth: string }> = [];
    globalThis.fetch = (async (url, init) => {
      seen.push({
        url: String(url),
        method: init?.method,
        auth: new Headers(init?.headers).get("authorization") ?? "",
      });
      return Response.json({
        posts: [{ id: "p 1", updated_at: "2024-01-01T00:00:00.000Z" }],
      });
    }) as typeof fetch;
    await run("post.update", { postId: "p 1", title: "New" });
    assert.deepEqual(
      seen.map(({ url, method }) => [url, method]),
      [
        [
          "https://blog.example.com/ghost/api/admin/posts/p%201/?fields=id%2Cupdated_at",
          "GET",
        ],
        ["https://blog.example.com/ghost/api/admin/posts/p%201/", "PUT"],
      ],
    );
    for (const { auth } of seen) {
      assert.match(auth, /^Ghost [\w-]+\.[\w-]+\.[\w-]+$/);
      const [head, body] = auth.slice(6).split(".");
      const decode = (part: string) =>
        JSON.parse(Buffer.from(part, "base64url").toString());
      assert.equal(decode(head).kid, "kid1");
      assert.equal(decode(body).aud, "/admin/");
    }
  });

  it("reads a post by an encoded slug", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (url) => {
      seen.push(String(url));
      return Response.json({ posts: [{}] });
    }) as typeof fetch;
    await run("post.get", { slug: "a b" });
    assert.deepEqual(seen, [
      "https://blog.example.com/ghost/api/admin/posts/slug/a%20b/",
    ]);
  });
});
