import assert from "node:assert/strict";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import facebookPages from "../../../codemode-plugins/facebookPages/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import { validateTypedInput } from "../plugin/schema.js";
import type { ActionContext, TypedInputSchema } from "../plugin/types.js";
import { getAction, stubFetch } from "./helpers/plugin.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const { api, resolve } = createPluginAPI("facebookPages");
facebookPages(api);
const plugin = resolve();

const POST = "134895793791914_2191966997525824";
const COMMENT = "2191966997525824_917077345377399";
const GRAPH = "https://graph.facebook.com/v27.0";

/** A connection holding a Page's token. */
const context: ActionContext = {
  connection: {
    name: "page",
    plugin: "facebookPages",
    config: { accessToken: "page-token" },
  },
  log: { info() {}, warn() {}, error() {} },
  async updateConnection() {},
};

type Call = { url: URL; init: RequestInit };

/** Answers each request with the next response, the last one repeating. */
function mock(responses: Array<() => Response>): Call[] {
  const calls: Call[] = [];
  stubFetch(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: new URL(String(url)), init: init ?? {} });
    return responses[Math.min(calls.length, responses.length) - 1]();
  });
  return calls;
}
const json =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
const header = (call: Call, name: string) =>
  new Headers(call.init.headers).get(name);
const bytes = (call: Call) => Buffer.from(call.init.body as Uint8Array);
const sent = (call: Call) => JSON.parse(bytes(call).toString());
/** A call's method and destination without its query, and the query by name. */
const place = (call: Call) =>
  `${call.init.method} ${call.url.origin}${call.url.pathname}`;
const query = (call: Call) => Object.fromEntries(call.url.searchParams);
const run = (name: string, input: unknown) =>
  getAction(plugin, name).execute(input, context);
/** The engine's verdict on an input, normalization included. */
const valid = (name: string, input: unknown) =>
  validateTypedInput(
    getAction(plugin, name).inputSchema as TypedInputSchema,
    input,
  ).ok;

describe("facebookPages inputs", () => {
  it("takes Graph IDs, plain or compound, and nothing that names a path", () => {
    assert.ok(valid("post.get", { postId: POST }));
    assert.ok(valid("post.get", { postId: "2191966997525824" }));
    assert.equal(valid("post.get", { postId: "me" }), false);
    assert.equal(valid("post.get", { postId: `${POST}/comments` }), false);
    assert.equal(valid("post.get", { postId: POST, extra: 1 }), false);
  });

  it("needs a post to have text, a link or photos", () => {
    const ok = (input: object) => valid("post.create", input);
    assert.ok(ok({ message: "Hello" }));
    assert.ok(ok({ link: "https://example.com" }));
    assert.ok(ok({ attachedMedia: [{ mediaFbid: "1" }, { mediaFbid: "2" }] }));
    assert.equal(ok({}), false);
    assert.equal(ok({ published: false }), false);
    assert.equal(ok({ link: "javascript:alert(1)" }), false);
  });

  it("schedules only what is not published", () => {
    const at = { scheduledPublishTime: 1800000000 };
    assert.ok(
      valid("post.create", { message: "Later", published: false, ...at }),
    );
    assert.equal(valid("post.create", { message: "Later", ...at }), false);
    assert.equal(
      valid("post.create", { message: "Later", published: true, ...at }),
      false,
    );
    const photo = { url: "https://example.com/a.jpg" };
    assert.ok(valid("photo.create", { ...photo, published: false, ...at }));
    assert.equal(valid("photo.create", { ...photo, ...at }), false);
  });

  it("takes a photo from a URL or a file, never both", () => {
    const ok = (input: object) => valid("photo.create", input);
    assert.ok(ok({ url: "https://example.com/a.jpg" }));
    assert.ok(ok({ contentPath: "/tmp/a.jpg" }));
    assert.equal(ok({}), false);
    assert.equal(ok({ caption: "no photo" }), false);
    assert.equal(
      ok({ url: "https://example.com/a.jpg", contentPath: "/tmp/a.jpg" }),
      false,
    );
  });

  it("needs a change to change something", () => {
    assert.ok(valid("post.update", { postId: POST, message: "New" }));
    assert.ok(valid("post.update", { postId: POST, isHidden: true }));
    assert.equal(valid("post.update", { postId: POST }), false);
    assert.ok(valid("comment.update", { commentId: COMMENT, isHidden: false }));
    assert.equal(valid("comment.update", { commentId: COMMENT }), false);
    assert.equal(valid("comment.create", { objectId: POST }), false);
    assert.equal(valid("setting.update", { option: {} }), false);
    assert.equal(
      valid("setting.update", { option: { USERS_CAN_POST: "true" } }),
      false,
    );
  });
});

describe("facebookPages reads", () => {
  it("is the Page its token was issued for, signed as a bearer", async () => {
    const calls = mock([json({ id: "134895793791914", name: "Metricsaurus" })]);
    assert.deepEqual(await run("page.get", {}), {
      id: "134895793791914",
      name: "Metricsaurus",
    });
    assert.equal(place(calls[0]), `GET ${GRAPH}/me`);
    assert.equal(
      query(calls[0]).fields,
      "id,name,about,category,link,website,fan_count,followers_count",
    );
    assert.equal(header(calls[0], "authorization"), "Bearer page-token");
  });

  it("reads the feed a page at a time, without paging links or tokens", async () => {
    const calls = mock([
      json({
        data: [{ id: POST, message: "Hello world!" }],
        paging: {
          cursors: { before: "b", after: "a" },
          next: `${GRAPH}/me/feed?after=a&access_token=page-token`,
        },
      }),
    ]);
    assert.deepEqual(
      await run("post.list", {
        limit: 1,
        since: 1700000000,
        fields: ["id", "message"],
      }),
      { data: [{ id: POST, message: "Hello world!" }], after: "a" },
    );
    assert.equal(place(calls[0]), `GET ${GRAPH}/me/feed`);
    assert.deepEqual(query(calls[0]), {
      fields: "id,message",
      limit: "1",
      since: "1700000000",
    });
    await run("post.listTagged", { after: "a" });
    assert.equal(place(calls[1]), `GET ${GRAPH}/me/tagged`);
    assert.equal(query(calls[1]).after, "a");
    assert.match(query(calls[1]).fields, /^id,message,story,created_time,/);
  });

  it("reads a post, a comment and a comment's replies by ID", async () => {
    const calls = mock([
      json({ id: "1" }),
      json({ id: "1" }),
      json({ data: [] }),
    ]);
    await run("post.get", { postId: POST });
    await run("comment.get", { commentId: COMMENT, fields: ["id", "message"] });
    await run("comment.list", { objectId: COMMENT });
    assert.deepEqual(calls.map(place), [
      `GET ${GRAPH}/${POST}`,
      `GET ${GRAPH}/${COMMENT}`,
      `GET ${GRAPH}/${COMMENT}/comments`,
    ]);
    assert.equal(query(calls[1]).fields, "id,message");
    assert.equal(
      query(calls[2]).fields,
      "id,message,from,created_time,like_count,comment_count,parent",
    );
  });

  it("answers the comments' summary when asked for it", async () => {
    const calls = mock([
      json({
        data: [{ id: COMMENT, message: "Nice" }],
        paging: { cursors: { before: "b", after: "a" } },
        summary: { order: "chronological", total_count: 12 },
      }),
    ]);
    assert.deepEqual(
      await run("comment.list", {
        objectId: POST,
        filter: "stream",
        summary: true,
      }),
      {
        data: [{ id: COMMENT, message: "Nice" }],
        after: "a",
        summary: { order: "chronological", total_count: 12 },
      },
    );
    assert.equal(query(calls[0]).filter, "stream");
    assert.equal(query(calls[0]).summary, "true");
  });

  it("reads insights, settings, roles and reviews from the Page's edges", async () => {
    const calls = mock([json({ data: [{ name: "page_impressions_unique" }] })]);
    assert.deepEqual(
      await run("page.insights", {
        metric: ["page_impressions_unique", "page_impressions_paid"],
        period: "day",
        since: 1583568000,
        until: 1583737200,
      }),
      { data: [{ name: "page_impressions_unique" }] },
    );
    await run("post.insights", {
      postId: POST,
      metric: ["post_reactions_like_total"],
    });
    await run("setting.list", {});
    await run("role.list", {});
    await run("rating.list", { limit: 10 });
    assert.deepEqual(calls.map(place), [
      `GET ${GRAPH}/me/insights`,
      `GET ${GRAPH}/${POST}/insights`,
      `GET ${GRAPH}/me/settings`,
      `GET ${GRAPH}/me/roles`,
      `GET ${GRAPH}/me/ratings`,
    ]);
    assert.deepEqual(query(calls[0]), {
      metric: "page_impressions_unique,page_impressions_paid",
      period: "day",
      since: "1583568000",
      until: "1583737200",
    });
    assert.deepEqual(query(calls[1]), { metric: "post_reactions_like_total" });
    assert.deepEqual(query(calls[4]), { limit: "10" });
    assert.equal(
      valid("page.insights", { metric: ["page_fans&access_token=x"] }),
      false,
    );
  });
});

describe("facebookPages changes", () => {
  it("posts text and a link in Meta's names", async () => {
    const calls = mock([json({ id: POST })]);
    assert.deepEqual(
      await run("post.create", {
        message: "Become a Facebook developer!",
        link: "https://developers.facebook.com",
      }),
      { id: POST },
    );
    assert.equal(place(calls[0]), `POST ${GRAPH}/me/feed`);
    assert.equal(header(calls[0], "content-type"), "application/json");
    assert.deepEqual(sent(calls[0]), {
      message: "Become a Facebook developer!",
      link: "https://developers.facebook.com",
    });
  });

  it("schedules a multi-photo post as Meta requires", async () => {
    const calls = mock([json({ id: POST })]);
    await run("post.create", {
      message: "Testing multi-photo post!",
      attachedMedia: [
        { mediaFbid: "1002088839996" },
        { mediaFbid: "1002088840149" },
      ],
      published: false,
      scheduledPublishTime: 1800000000,
    });
    await run("post.create", {
      message: "Later",
      published: false,
      scheduledPublishTime: 1800000000,
    });
    assert.deepEqual(sent(calls[0]), {
      message: "Testing multi-photo post!",
      attached_media: [
        { media_fbid: "1002088839996" },
        { media_fbid: "1002088840149" },
      ],
      published: false,
      scheduled_publish_time: 1800000000,
      unpublished_content_type: "SCHEDULED",
    });
    assert.deepEqual(sent(calls[1]), {
      message: "Later",
      published: false,
      scheduled_publish_time: 1800000000,
    });
  });

  it("updates and deletes a post", async () => {
    const calls = mock([json({ success: true })]);
    await run("post.update", {
      postId: POST,
      message: "Edited",
      isHidden: true,
    });
    await run("post.update", { postId: POST, isPublished: true });
    await run("post.delete", { postId: POST });
    assert.deepEqual(calls.map(place), [
      `POST ${GRAPH}/${POST}`,
      `POST ${GRAPH}/${POST}`,
      `DELETE ${GRAPH}/${POST}`,
    ]);
    assert.deepEqual(sent(calls[0]), { message: "Edited", is_hidden: true });
    assert.deepEqual(sent(calls[1]), { is_published: true });
  });

  it("adds a photo from a URL", async () => {
    const calls = mock([json({ id: "1", post_id: POST })]);
    assert.deepEqual(
      await run("photo.create", {
        url: "https://example.com/a.jpg",
        caption: "A photo",
        altTextCustom: "A bronze statue",
        published: false,
        temporary: true,
      }),
      { id: "1", post_id: POST },
    );
    assert.equal(place(calls[0]), `POST ${GRAPH}/me/photos`);
    assert.deepEqual(sent(calls[0]), {
      url: "https://example.com/a.jpg",
      caption: "A photo",
      alt_text_custom: "A bronze statue",
      published: false,
      temporary: true,
    });
  });

  it("uploads a local photo as multipart form data", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fb-photo-"));
    try {
      const file = join(dir, "statue.jpg");
      writeFileSync(file, "jpeg-bytes");
      const calls = mock([json({ id: "1", post_id: POST })]);
      await run("photo.create", {
        contentPath: file,
        caption: "A photo",
        published: false,
      });
      const [call] = calls;
      assert.equal(place(call), `POST ${GRAPH}/me/photos`);
      assert.match(
        header(call, "content-type") ?? "",
        /^multipart\/form-data; boundary=/,
      );
      const form = await new Response(bytes(call), {
        headers: { "content-type": header(call, "content-type") ?? "" },
      }).formData();
      assert.equal(form.get("caption"), "A photo");
      assert.equal(form.get("published"), "false");
      const source = form.get("source") as File;
      assert.equal(source.name, "statue.jpg");
      assert.equal(await source.text(), "jpeg-bytes");

      const big = join(dir, "big.jpg");
      writeFileSync(big, "");
      truncateSync(big, 10 * 1024 * 1024 + 1);
      await assert.rejects(
        run("photo.create", { contentPath: big }),
        /contentPath is larger than 10 MB/,
      );
      assert.equal(calls.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("comments, replies, hides and deletes as the Page", async () => {
    const calls = mock([json({ id: COMMENT }), json({ success: true })]);
    await run("comment.create", { objectId: POST, message: "Thanks @[1234]" });
    await run("comment.create", {
      objectId: COMMENT,
      attachmentUrl: "https://example.com/a.png",
    });
    await run("comment.update", { commentId: COMMENT, isHidden: true });
    await run("comment.delete", { commentId: COMMENT });
    assert.deepEqual(calls.map(place), [
      `POST ${GRAPH}/${POST}/comments`,
      `POST ${GRAPH}/${COMMENT}/comments`,
      `POST ${GRAPH}/${COMMENT}`,
      `DELETE ${GRAPH}/${COMMENT}`,
    ]);
    assert.deepEqual(sent(calls[0]), { message: "Thanks @[1234]" });
    assert.deepEqual(sent(calls[1]), {
      attachment_url: "https://example.com/a.png",
    });
    assert.deepEqual(sent(calls[2]), { is_hidden: true });
  });

  it("changes a setting and blocks a person", async () => {
    const calls = mock([json({ success: true }), json({ "5678": true })]);
    await run("setting.update", { option: { USERS_CAN_MESSAGE: true } });
    assert.deepEqual(await run("page.blockUser", { user: "5678" }), {
      "5678": true,
    });
    assert.deepEqual(calls.map(place), [
      `POST ${GRAPH}/me/settings`,
      `POST ${GRAPH}/me/blocked`,
    ]);
    assert.deepEqual(sent(calls[0]), { option: { USERS_CAN_MESSAGE: true } });
    assert.deepEqual(sent(calls[1]), { user: "5678" });
  });
});

describe("facebookPages failures", () => {
  const failure = (error: Record<string, unknown>, status = 400) =>
    json({ error }, status);

  it("says a person's token is not a Page's, without calling it expired", async () => {
    mock([
      failure({
        message: "A Page access token is required for this call.",
        type: "OAuthException",
        code: 190,
        error_subcode: 2069032,
        fbtrace_id: "AbC-123",
      }),
    ]);
    await assert.rejects(
      run("post.list", {}),
      (error: Error & { code?: string }) => {
        assert.equal(
          error.message,
          "facebookPages: request failed (HTTP 400 190.2069032): this call takes a Page access token; connect the Page's own token, not a person's (fbtrace_id AbC-123)",
        );
        assert.equal(error.code, undefined);
        return true;
      },
    );
  });

  it("reports an expired token as a login to reconnect", async () => {
    mock([
      failure({
        message: "Session has expired",
        code: 190,
        error_subcode: 463,
      }),
    ]);
    await assert.rejects(run("page.get", {}), { code: "reconnect_required" });
  });

  it("reports Meta's code with a hint, never its text", async () => {
    mock([
      failure({ message: "Duplicate status message, token=secret", code: 506 }),
      failure(
        { message: "(#283) Requires pages_read_engagement", code: 283 },
        403,
      ),
    ]);
    await assert.rejects(run("post.create", { message: "Again" }), {
      message:
        "facebookPages: request failed (HTTP 400 506): Meta refuses the same post twice in a row; change its content",
    });
    await assert.rejects(run("post.list", {}), {
      message:
        "facebookPages: request failed (HTTP 403 283): the token lacks a permission this call needs",
    });
  });

  it("says a change's outcome is unknown after a 5xx or no answer", async () => {
    mock([failure({ code: 2 }, 503)]);
    await assert.rejects(run("post.create", { message: "Hello" }), {
      message:
        "facebookPages: request failed (HTTP 503 2). The change may have been applied: check before sending it again.",
    });
    await assert.rejects(run("post.list", {}), {
      message: "facebookPages: request failed (HTTP 503 2)",
    });
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(
      run("post.delete", { postId: POST }),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "transport_failed");
        assert.match(error.message, /The change may have been applied/);
        return true;
      },
    );
  });
});
