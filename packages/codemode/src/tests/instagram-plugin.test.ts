import assert from "node:assert/strict";
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { snake } from "../../../codemode-plugins/_shared/metaGraph.js";
import instagram from "../../../codemode-plugins/instagram/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import { validateTypedInput } from "../plugin/schema.js";
import type { ActionContext, TypedInputSchema } from "../plugin/types.js";
import { getAction, stubFetch } from "./helpers/plugin.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const { api, resolve } = createPluginAPI("instagram");
instagram(api);
const plugin = resolve();

const ACCOUNT = "17841405822304914";
const MEDIA = "17895695668004550";
const COMMENT = "17870913679156914";
const GRAPH = "https://graph.facebook.com/v27.0";

/** A connection holding a token, and the account its calls are about. */
function context(config: Record<string, unknown> = {}): ActionContext {
  return {
    connection: {
      name: "ig",
      plugin: "instagram",
      config: { accessToken: "token", igUserId: ACCOUNT, ...config },
    },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
}

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
/** A call's destination without its query, and the query by name. */
const place = (call: Call) => `${call.url.origin}${call.url.pathname}`;
const query = (call: Call) => Object.fromEntries(call.url.searchParams);
const run = (name: string, input: unknown, ctx = context()) =>
  getAction(plugin, name).execute(input, ctx);
/** The engine's verdict on an input, normalization included. */
const valid = (name: string, input: unknown) =>
  validateTypedInput(
    getAction(plugin, name).inputSchema as TypedInputSchema,
    input,
  ).ok;

describe("instagram inputs", () => {
  it("takes numeric IDs, and nothing that could name another path", () => {
    assert.ok(valid("media.get", { mediaId: MEDIA }));
    assert.equal(valid("media.get", { mediaId: "me" }), false);
    assert.equal(valid("media.get", { mediaId: `${MEDIA}/comments` }), false);
    assert.equal(valid("media.get", { mediaId: "" }), false);
    assert.equal(valid("media.get", { mediaId: MEDIA, extra: 1 }), false);
    assert.equal(valid("media.list", { igUserId: "me" }), false);
  });

  it("takes field names and edge expansions, and nothing else", () => {
    const fields = (list: string[]) =>
      valid("media.get", { mediaId: MEDIA, fields: list });
    assert.ok(fields(["id", "caption"]));
    assert.ok(fields(["children{id,media_url}", "comments.limit(5){text}"]));
    assert.equal(fields([]), false);
    assert.equal(fields(["id caption"]), false);
    assert.equal(fields(["id&access_token=x"]), false);
    assert.equal(fields(['id"']), false);
  });

  it("needs a container's media to come from somewhere", () => {
    const ok = (input: object) => valid("container.create", input);
    assert.ok(ok({ imageUrl: "https://cdn.example/a.jpg" }));
    assert.ok(
      ok({ mediaType: "REELS", videoUrl: "https://cdn.example/a.mp4" }),
    );
    assert.ok(ok({ mediaType: "REELS", uploadType: "resumable" }));
    assert.ok(ok({ mediaType: "CAROUSEL", children: ["1", "2"] }));
    assert.equal(ok({ caption: "no media" }), false);
    assert.equal(ok({ mediaType: "CAROUSEL", children: ["1"] }), false);
    assert.equal(ok({ imageUrl: "file:///etc/passwd" }), false);
    assert.equal(
      ok({ imageUrl: "https://x/a.jpg", mediaType: "IMAGE" }),
      false,
    );
    assert.equal(
      ok({
        imageUrl: "https://x/a.jpg",
        userTags: [{ username: "kevin", x: 1.5, y: 0.2 }],
      }),
      false,
    );
  });

  it("uploads from a file or a URL, never both", () => {
    const ok = (input: object) =>
      valid("container.upload", { containerId: "1", ...input });
    assert.ok(ok({ contentPath: "/tmp/a.mp4" }));
    assert.ok(ok({ fileUrl: "https://cdn.example/a.mp4" }));
    assert.equal(ok({}), false);
    assert.equal(
      ok({ contentPath: "/tmp/a.mp4", fileUrl: "https://cdn.example/a.mp4" }),
      false,
    );
  });

  it("sends a message to one recipient, with text or one attachment", () => {
    const ok = (input: object) => valid("message.send", input);
    const text = { text: "hi" };
    assert.ok(ok({ recipient: { id: "igsid" }, message: text }));
    assert.ok(ok({ recipient: { commentId: COMMENT }, message: text }));
    assert.ok(
      ok({
        recipient: { id: "igsid" },
        message: {
          attachment: { type: "image", payload: { url: "https://x/a.png" } },
        },
        replyTo: { mid: "m_1" },
      }),
    );
    assert.equal(ok({ recipient: {}, message: text }), false);
    assert.equal(
      ok({ recipient: { id: "igsid", commentId: COMMENT }, message: text }),
      false,
    );
    assert.equal(ok({ recipient: { id: "igsid" }, message: {} }), false);
    assert.equal(
      ok({
        recipient: { id: "igsid" },
        message: { text: "hi", attachment: { type: "like_heart" } },
      }),
      false,
    );
  });
});

describe("instagram credential", () => {
  it("sends the token as a bearer to graph.facebook.com by default", async () => {
    const calls = mock([json({ id: MEDIA })]);
    await run("media.get", { mediaId: MEDIA, fields: ["id"] });
    assert.equal(calls[0].url.href, `${GRAPH}/${MEDIA}?fields=id`);
    assert.equal(header(calls[0], "authorization"), "Bearer token");
  });

  it("calls graph.instagram.com for an Instagram Login token", async () => {
    const calls = mock([json({ id: MEDIA })]);
    await run(
      "media.get",
      { mediaId: MEDIA },
      context({ apiHost: "graph.instagram.com" }),
    );
    assert.equal(place(calls[0]), `https://graph.instagram.com/v27.0/${MEDIA}`);
  });

  it("refuses a host that is not one of Meta's two", async () => {
    const calls = mock([json({})]);
    await assert.rejects(
      run(
        "media.get",
        { mediaId: MEDIA },
        context({ apiHost: "graph.facebook.com.evil.example" }),
      ),
      { code: "invalid_credentials" },
    );
    assert.equal(calls.length, 0);
  });
});

describe("instagram accounts", () => {
  it("is about the account a call names, else the connection's", async () => {
    const calls = mock([json({ data: [] })]);
    await run("media.list", {});
    await run("media.list", { igUserId: "17841400000000001" });
    assert.equal(place(calls[0]), `${GRAPH}/${ACCOUNT}/media`);
    assert.equal(place(calls[1]), `${GRAPH}/17841400000000001/media`);
  });

  it("needs an account on graph.facebook.com, where me is not one", async () => {
    const calls = mock([json({ data: [] })]);
    await assert.rejects(
      run("media.list", {}, context({ igUserId: undefined })),
      /igUserId is required.*account\.list/,
    );
    await assert.rejects(
      run("media.list", {}, context({ igUserId: "me" })),
      /igUserId must be a numeric account ID/,
    );
    assert.equal(calls.length, 0);
  });

  it("is the token's own account on graph.instagram.com", async () => {
    const calls = mock([json({ data: [] })]);
    const ctx = context({
      apiHost: "graph.instagram.com",
      igUserId: undefined,
    });
    await run("media.list", {}, ctx);
    assert.equal(place(calls[0]), "https://graph.instagram.com/v27.0/me/media");
    // A parameter takes a real ID: hashtag search cannot ask as `me`.
    await assert.rejects(
      run("hashtag.search", { q: "coke" }, ctx),
      /igUserId is required/,
    );
  });

  it("lists the accounts shared with the token", async () => {
    const calls = mock([
      json({
        data: [{ id: ACCOUNT, username: "metricsaurus" }],
        paging: { cursors: { before: "b", after: "a" } },
      }),
    ]);
    assert.deepEqual(await run("account.list", {}), {
      data: [{ id: ACCOUNT, username: "metricsaurus" }],
      after: "a",
    });
    assert.equal(place(calls[0]), `${GRAPH}/me/assigned_instagram_accounts`);
    assert.equal(query(calls[0]).fields, "id,username");
  });

  it("lists the token's own account on graph.instagram.com", async () => {
    const calls = mock([json({ user_id: ACCOUNT, username: "metricsaurus" })]);
    assert.deepEqual(
      await run(
        "account.list",
        {},
        context({ apiHost: "graph.instagram.com" }),
      ),
      { data: [{ user_id: ACCOUNT, username: "metricsaurus" }] },
    );
    assert.equal(
      calls[0].url.href.endsWith("/me?fields=user_id%2Cusername"),
      true,
    );
  });

  it("lists Pages with their Instagram accounts, never their tokens", async () => {
    const calls = mock([json({ data: [] })]);
    await run("page.list", {});
    assert.equal(place(calls[0]), `${GRAPH}/me/accounts`);
    assert.equal(
      query(calls[0]).fields,
      "id,name,instagram_business_account{id,username}",
    );
    assert.equal(valid("page.list", { fields: ["access_token"] }), false);
  });

  it("never answers a Page's token, however a call reaches the Page", async () => {
    // An ID is free text for a conversation, so it can name `me`, and a
    // field can be an edge whose default answer includes each token.
    const calls = mock([
      json({
        id: "1",
        access_token: "page-token",
        accounts: {
          data: [{ id: "2", access_token: "page-token-2", name: "Page" }],
          paging: { next: `${GRAPH}/1/accounts?after=a&access_token=token` },
        },
      }),
    ]);
    assert.deepEqual(
      await run("conversation.get", {
        conversationId: "me",
        fields: ["accounts", "access_token"],
      }),
      {
        id: "1",
        accounts: {
          data: [{ id: "2", name: "Page" }],
          paging: { next: `${GRAPH}/1/accounts?after=a` },
        },
      },
    );
    assert.equal(query(calls[0]).fields, "accounts,access_token");
  });
});

describe("instagram reads", () => {
  it("asks for default fields, or the ones a call names", async () => {
    const calls = mock([json({ id: MEDIA })]);
    await run("media.get", { mediaId: MEDIA });
    await run("media.get", {
      mediaId: MEDIA,
      fields: ["id", "children{id,media_url}"],
    });
    assert.equal(
      query(calls[0]).fields,
      "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,username,like_count,comments_count",
    );
    assert.equal(query(calls[1]).fields, "id,children{id,media_url}");
  });

  it("reads a profile with each host's own field names", async () => {
    const calls = mock([json({ id: ACCOUNT })]);
    await run("user.get", {});
    await run("user.get", {}, context({ apiHost: "graph.instagram.com" }));
    assert.match(query(calls[0]).fields, /^id,username,name,biography,/);
    assert.match(
      query(calls[1]).fields,
      /^user_id,username,name,account_type,/,
    );
  });

  it("answers a page with the cursor of the next, and no paging links", async () => {
    const calls = mock([
      json({
        data: [{ id: "1" }, { id: "2" }],
        paging: {
          cursors: { before: "b1", after: "a1" },
          next: `${GRAPH}/${ACCOUNT}/media?after=a1&access_token=leak`,
        },
      }),
      // The last page: items and cursors, but no link to another.
      json({ data: [], paging: { cursors: { before: "b2", after: "a2" } } }),
    ]);
    assert.deepEqual(await run("media.list", { limit: 2, since: 1700000000 }), {
      data: [{ id: "1" }, { id: "2" }],
      after: "a1",
    });
    assert.deepEqual(await run("media.list", { limit: 2, after: "a1" }), {
      data: [],
    });
    assert.equal(query(calls[0]).limit, "2");
    assert.equal(query(calls[0]).since, "1700000000");
    assert.equal(query(calls[0]).after, undefined);
    assert.equal(query(calls[1]).after, "a1");
  });

  it("keeps paging an edge that links to no next page while it has items", async () => {
    mock([
      json({
        data: [{ id: "1" }],
        paging: { cursors: { before: "b", after: "a" } },
      }),
    ]);
    assert.deepEqual(
      await run("tag.list", {
        mediaType: ["IMAGE", "VIDEO"],
        postedAfter: "2026-11-01T00:00:00",
      }),
      { data: [{ id: "1" }], after: "a" },
    );
  });

  it("filters tags by type and time in Meta's names", async () => {
    const calls = mock([json({ data: [] })]);
    await run("tag.list", {
      mediaType: ["IMAGE", "VIDEO"],
      postedAfter: "2026-11-01T00:00:00",
      postedBefore: "2026-11-18T00:00:00",
    });
    const sentQuery = query(calls[0]);
    assert.equal(place(calls[0]), `${GRAPH}/${ACCOUNT}/tags`);
    assert.equal(sentQuery.media_type, "IMAGE,VIDEO");
    assert.equal(sentQuery.posted_after, "2026-11-01T00:00:00");
    assert.equal(sentQuery.posted_before, "2026-11-18T00:00:00");
  });

  it("reads comments, replies and a carousel's items from their edges", async () => {
    const calls = mock([json({ data: [] })]);
    await run("comment.list", { mediaId: MEDIA });
    await run("comment.listReplies", { commentId: COMMENT });
    await run("media.listChildren", { mediaId: MEDIA });
    await run("story.list", {});
    assert.deepEqual(calls.map(place), [
      `${GRAPH}/${MEDIA}/comments`,
      `${GRAPH}/${COMMENT}/replies`,
      `${GRAPH}/${MEDIA}/children`,
      `${GRAPH}/${ACCOUNT}/stories`,
    ]);
    assert.match(query(calls[0]).fields, /^id,text,timestamp,username,from,/);
    assert.equal(
      query(calls[2]).fields,
      "id,media_type,media_url,thumbnail_url,timestamp",
    );
  });

  it("finds another business by username, or answers null", async () => {
    const calls = mock([
      json({
        business_discovery: { followers_count: 267788, id: "1" },
        id: ACCOUNT,
      }),
      json({ id: ACCOUNT }),
    ]);
    assert.deepEqual(
      await run("user.businessDiscovery", {
        username: "bluebottle",
        fields: ["followers_count", "media{like_count}"],
      }),
      { followers_count: 267788, id: "1" },
    );
    assert.equal(
      query(calls[0]).fields,
      "business_discovery.username(bluebottle){followers_count,media{like_count}}",
    );
    assert.equal(
      await run("user.businessDiscovery", { username: "nobody" }),
      null,
    );
    assert.equal(
      valid("user.businessDiscovery", { username: "a){id},followers_count" }),
      false,
    );
  });

  it("reads a mention by the ID its webhook named", async () => {
    const calls = mock([
      json({ mentioned_comment: { id: COMMENT, text: "hi" }, id: ACCOUNT }),
      json({ mentioned_media: { id: MEDIA }, id: ACCOUNT }),
    ]);
    assert.deepEqual(await run("mention.getComment", { commentId: COMMENT }), {
      id: COMMENT,
      text: "hi",
    });
    assert.deepEqual(await run("mention.getMedia", { mediaId: MEDIA }), {
      id: MEDIA,
    });
    assert.equal(
      query(calls[0]).fields,
      `mentioned_comment.comment_id(${COMMENT}){id,text,timestamp,like_count,media}`,
    );
    assert.match(
      query(calls[1]).fields,
      new RegExp(`^mentioned_media\\.media_id\\(${MEDIA}\\)\\{id,caption,`),
    );
  });

  it("asks for metrics as comma lists, and answers their data", async () => {
    const calls = mock([
      json({ data: [{ name: "reach" }], paging: { next: "https://x" } }),
    ]);
    assert.deepEqual(
      await run("user.insights", {
        metric: ["reach", "views"],
        period: "day",
        metricType: "total_value",
        breakdown: ["media_product_type"],
        since: 1658991600,
      }),
      { data: [{ name: "reach" }] },
    );
    assert.equal(place(calls[0]), `${GRAPH}/${ACCOUNT}/insights`);
    assert.deepEqual(query(calls[0]), {
      metric: "reach,views",
      metric_type: "total_value",
      breakdown: "media_product_type",
      period: "day",
      since: "1658991600",
    });
    await run("media.insights", {
      mediaId: MEDIA,
      metric: ["profile_activity"],
      breakdown: ["action_type"],
    });
    assert.equal(place(calls[1]), `${GRAPH}/${MEDIA}/insights`);
    assert.deepEqual(query(calls[1]), {
      metric: "profile_activity",
      breakdown: "action_type",
    });
    assert.equal(
      valid("user.insights", { metric: ["reach&x=1"], period: "day" }),
      false,
    );
    // Only the timeframes the pinned API version still takes.
    const demographics = {
      metric: ["follower_demographics"],
      period: "lifetime",
    };
    assert.ok(
      valid("user.insights", { ...demographics, timeframe: "this_month" }),
    );
    assert.equal(
      valid("user.insights", { ...demographics, timeframe: "last_90_days" }),
      false,
    );
  });

  it("searches hashtags as the account", async () => {
    const calls = mock([json({ data: [{ id: "17843857450040591" }] })]);
    assert.deepEqual(await run("hashtag.search", { q: "bluebottle" }), {
      data: [{ id: "17843857450040591" }],
    });
    assert.equal(place(calls[0]), `${GRAPH}/ig_hashtag_search`);
    assert.deepEqual(query(calls[0]), { user_id: ACCOUNT, q: "bluebottle" });
    await run("hashtag.listTopMedia", { hashtagId: "17843857450040591" });
    await run("hashtag.listRecentMedia", {
      hashtagId: "17843857450040591",
      limit: 50,
    });
    await run("hashtag.listRecentlySearched", {});
    assert.deepEqual(calls.slice(1).map(place), [
      `${GRAPH}/17843857450040591/top_media`,
      `${GRAPH}/17843857450040591/recent_media`,
      `${GRAPH}/${ACCOUNT}/recently_searched_hashtags`,
    ]);
    assert.equal(query(calls[1]).user_id, ACCOUNT);
    assert.equal(query(calls[2]).limit, "50");
    assert.equal(valid("hashtag.search", { q: "#coke" }), false);
  });

  it("reads conversations and their messages", async () => {
    const calls = mock([json({ data: [] }), json({ id: "c1" })]);
    await run("conversation.list", { userId: "igsid" });
    await run("conversation.get", { conversationId: "aWdfZAG1" });
    await run("message.get", { messageId: "aWdGGiblWZ" });
    assert.equal(place(calls[0]), `${GRAPH}/${ACCOUNT}/conversations`);
    assert.deepEqual(query(calls[0]), {
      platform: "instagram",
      user_id: "igsid",
    });
    assert.equal(calls[1].url.href, `${GRAPH}/aWdfZAG1?fields=messages`);
    assert.equal(query(calls[2]).fields, "id,created_time,from,to,message");
    await assert.rejects(run("conversation.get", { conversationId: "../me" }), {
      code: "request_not_allowed",
    });
  });
});

describe("instagram publishing", () => {
  it("creates a container with Meta's parameter names", async () => {
    const calls = mock([json({ id: "17889455560051444" })]);
    assert.deepEqual(
      await run("container.create", {
        imageUrl: "https://cdn.example/a.jpg",
        caption: "#BronzedFonzes!",
        altText: "A bronze statue",
        userTags: [{ username: "therock", x: 0.3, y: 0.2 }],
        isAiGenerated: true,
      }),
      { id: "17889455560051444" },
    );
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].url.href, `${GRAPH}/${ACCOUNT}/media`);
    assert.equal(header(calls[0], "content-type"), "application/json");
    assert.deepEqual(sent(calls[0]), {
      image_url: "https://cdn.example/a.jpg",
      caption: "#BronzedFonzes!",
      alt_text: "A bronze statue",
      user_tags: [{ username: "therock", x: 0.3, y: 0.2 }],
      is_ai_generated: true,
    });
  });

  it("creates a carousel from its items' containers", async () => {
    const calls = mock([json({ id: "3" })]);
    await run("container.create", {
      mediaType: "CAROUSEL",
      children: ["1", "2"],
      caption: "Fruit candies",
    });
    assert.deepEqual(sent(calls[0]), {
      media_type: "CAROUSEL",
      children: "1,2",
      caption: "Fruit candies",
    });
  });

  it("creates a trial reel and a poll with their nested names", async () => {
    const calls = mock([json({ id: "3" })]);
    await run("container.create", {
      mediaType: "REELS",
      videoUrl: "https://cdn.example/a.mp4",
      shareToFeed: false,
      thumbOffset: 1500,
      trialParams: { graduationStrategy: "MANUAL" },
      pollAttachment: { optionA: "Yes", optionB: "No" },
    });
    assert.deepEqual(sent(calls[0]), {
      media_type: "REELS",
      video_url: "https://cdn.example/a.mp4",
      share_to_feed: false,
      thumb_offset: 1500,
      trial_params: { graduation_strategy: "MANUAL" },
      poll_attachment: { option_a: "Yes", option_b: "No" },
    });
  });

  it("reads a container's status, then publishes it", async () => {
    const calls = mock([
      json({ id: "3", status_code: "FINISHED" }),
      json({ id: MEDIA, config_issue: "CAPTION_NOT_ATTACHED" }),
    ]);
    assert.deepEqual(await run("container.get", { containerId: "3" }), {
      id: "3",
      status_code: "FINISHED",
    });
    assert.equal(
      calls[0].url.href,
      `${GRAPH}/3?fields=id%2Cstatus_code%2Cstatus`,
    );
    assert.deepEqual(await run("media.publish", { creationId: "3" }), {
      id: MEDIA,
      config_issue: "CAPTION_NOT_ATTACHED",
    });
    assert.equal(calls[1].url.href, `${GRAPH}/${ACCOUNT}/media_publish`);
    assert.deepEqual(sent(calls[1]), { creation_id: "3" });
  });

  it("uploads a local video under Meta's upload scheme", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ig-upload-"));
    try {
      const file = join(dir, "reel.mp4");
      writeFileSync(file, "video-bytes");
      const calls = mock([
        json({ success: true, message: "Upload successful." }),
      ]);
      assert.deepEqual(
        await run("container.upload", { containerId: "3", contentPath: file }),
        { success: true },
      );
      const [call] = calls;
      assert.equal(
        call.url.href,
        "https://rupload.facebook.com/ig-api-upload/v27.0/3",
      );
      assert.equal(call.init.method, "POST");
      assert.equal(header(call, "authorization"), "OAuth token");
      assert.equal(header(call, "offset"), "0");
      assert.equal(header(call, "file_size"), "11");
      assert.equal(header(call, "content-type"), "application/octet-stream");
      assert.equal(bytes(call).toString(), "video-bytes");

      const big = join(dir, "big.mp4");
      writeFileSync(big, "");
      truncateSync(big, 64 * 1024 * 1024 + 1);
      await assert.rejects(
        run("container.upload", { containerId: "3", contentPath: big }),
        /larger than 64 MiB.*fileUrl/,
      );
      assert.equal(calls.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("has Meta fetch a hosted video, and reports a refused upload", async () => {
    const calls = mock([
      json({ success: true }),
      json({
        debug_info: {
          retriable: false,
          type: "ProcessingFailedError",
          message: "unauthorized user request for token",
        },
      }),
    ]);
    await run("container.upload", {
      containerId: "3",
      fileUrl: "https://cdn.example/a.mp4",
    });
    assert.equal(header(calls[0], "file_url"), "https://cdn.example/a.mp4");
    assert.equal(calls[0].init.body ?? null, null);
    await assert.rejects(
      run("container.upload", {
        containerId: "3",
        fileUrl: "https://cdn.example/a.mp4",
      }),
      (error: Error) => {
        assert.equal(
          error.message,
          "instagram: request failed (ProcessingFailedError)",
        );
        return true;
      },
    );
  });
});

describe("instagram changes", () => {
  it("moderates comments on the endpoints Meta documents", async () => {
    const calls = mock([json({ id: "1" }), json({ success: true })]);
    await run("comment.create", {
      mediaId: MEDIA,
      message: "This is awesome!",
    });
    await run("comment.reply", { commentId: COMMENT, message: "Thanks!" });
    await run("comment.update", { commentId: COMMENT, hide: true });
    await run("comment.delete", { commentId: COMMENT });
    await run("media.update", { mediaId: MEDIA, commentEnabled: false });
    await run("media.delete", { mediaId: MEDIA });
    assert.deepEqual(
      calls.map((call) => `${call.init.method} ${call.url.href}`),
      [
        `POST ${GRAPH}/${MEDIA}/comments?message=This+is+awesome%21`,
        `POST ${GRAPH}/${COMMENT}/replies`,
        `POST ${GRAPH}/${COMMENT}?hide=true`,
        `DELETE ${GRAPH}/${COMMENT}`,
        `POST ${GRAPH}/${MEDIA}?comment_enabled=false`,
        `DELETE ${GRAPH}/${MEDIA}`,
      ],
    );
    assert.deepEqual(sent(calls[1]), { message: "Thanks!" });
  });

  it("replies to a mention on its media, or under its comment", async () => {
    const calls = mock([json({ id: "1" })]);
    await run("mention.reply", { mediaId: MEDIA, message: "Thanks!" });
    await run("mention.reply", {
      mediaId: MEDIA,
      commentId: COMMENT,
      message: "Enjoy!",
    });
    assert.equal(place(calls[0]), `${GRAPH}/${ACCOUNT}/mentions`);
    assert.deepEqual(query(calls[0]), { media_id: MEDIA, message: "Thanks!" });
    assert.deepEqual(query(calls[1]), {
      media_id: MEDIA,
      comment_id: COMMENT,
      message: "Enjoy!",
    });
  });

  it("sends a message, a reply and a private reply in Meta's shape", async () => {
    const calls = mock([json({ recipient_id: "igsid", message_id: "m_2" })]);
    assert.deepEqual(
      await run("message.send", {
        recipient: { id: "igsid" },
        message: { text: "Hello" },
        replyTo: { mid: "m_1" },
      }),
      { recipient_id: "igsid", message_id: "m_2" },
    );
    await run("message.send", {
      recipient: { commentId: COMMENT },
      message: { text: "Thanks for commenting" },
    });
    await run("message.send", {
      recipient: { id: "igsid" },
      message: { attachment: { type: "MEDIA_SHARE", payload: { id: MEDIA } } },
    });
    assert.equal(calls[0].url.href, `${GRAPH}/${ACCOUNT}/messages`);
    assert.deepEqual(sent(calls[0]), {
      recipient: { id: "igsid" },
      message: { text: "Hello" },
      reply_to: { mid: "m_1" },
    });
    assert.deepEqual(sent(calls[1]), {
      recipient: { comment_id: COMMENT },
      message: { text: "Thanks for commenting" },
    });
    assert.deepEqual(sent(calls[2]), {
      recipient: { id: "igsid" },
      message: { attachment: { type: "MEDIA_SHARE", payload: { id: MEDIA } } },
    });
  });

  it("names every key in snake_case and drops what is undefined", () => {
    assert.deepEqual(
      snake({
        isCarouselItem: true,
        caption: undefined,
        productTags: [{ productId: "1", x: 0 }],
        text: null,
      }),
      {
        is_carousel_item: true,
        product_tags: [{ product_id: "1", x: 0 }],
        text: null,
      },
    );
  });
});

describe("instagram failures", () => {
  const failure = (error: Record<string, unknown>, status = 400) =>
    json({ error }, status);

  it("reports Meta's code, subcode and trace, with a hint, never its text", async () => {
    mock([
      failure({
        message: "The media is not ready for publishing, token=secret",
        type: "OAuthException",
        code: 9007,
        error_subcode: 2207027,
        error_user_msg: "please wait for a moment, token=secret",
        fbtrace_id: "A6LJylpZRKw2xKLFsAP-cJh",
      }),
    ]);
    await assert.rejects(
      run("media.publish", { creationId: "3" }),
      (error: Error & { status?: number }) => {
        assert.equal(
          error.message,
          "instagram: request failed (HTTP 400 9007.2207027): the container is not ready; wait until container.get answers status_code FINISHED (fbtrace_id A6LJylpZRKw2xKLFsAP-cJh)",
        );
        assert.equal(error.status, 400);
        return true;
      },
    );
  });

  it("reports a code Meta documents no subcode for", async () => {
    mock([
      failure({
        message: "Unsupported get request",
        type: "GraphMethodException",
        code: 100,
      }),
      failure({ message: "Too many calls", code: 4 }, 403),
      failure({ message: "(#10) No permission", code: 10 }, 403),
    ]);
    await assert.rejects(run("media.get", { mediaId: MEDIA }), {
      message: "instagram: request failed (HTTP 400 100)",
    });
    await assert.rejects(run("media.get", { mediaId: MEDIA }), {
      message:
        "instagram: request failed (HTTP 403 4): the call was rate limited; wait before trying again",
    });
    await assert.rejects(run("media.get", { mediaId: MEDIA }), {
      message:
        "instagram: request failed (HTTP 403 10): the token lacks a permission this call needs; a story's insights answer this while it has fewer than 5 viewers",
    });
  });

  it("reports an expired or revoked token as a login to reconnect", async () => {
    mock([
      failure({
        message: "Error validating access token: Session has expired",
        type: "OAuthException",
        code: 190,
        error_subcode: 463,
      }),
    ]);
    await assert.rejects(
      run("media.get", { mediaId: MEDIA }),
      (error: Error & { code?: string; status?: number }) => {
        assert.equal(error.code, "reconnect_required");
        assert.equal(error.status, 400);
        assert.doesNotMatch(error.message, /Session/);
        return true;
      },
    );
  });

  it("says a change's outcome is unknown after a 5xx, not a read's", async () => {
    mock([
      failure({ code: 2, message: "Service temporarily unavailable" }, 503),
    ]);
    await assert.rejects(run("media.publish", { creationId: "3" }), {
      message:
        "instagram: request failed (HTTP 503 2). The change may have been applied: check before sending it again.",
    });
    await assert.rejects(run("media.list", {}), {
      message: "instagram: request failed (HTTP 503 2)",
    });
  });

  it("says a change's outcome is unknown when no answer arrives", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(
      run("comment.delete", { commentId: COMMENT }),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "transport_failed");
        assert.match(error.message, /The change may have been applied/);
        return true;
      },
    );
    await assert.rejects(
      run("media.get", { mediaId: MEDIA }),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "transport_failed");
        assert.doesNotMatch(error.message, /may have been applied/);
        return true;
      },
    );
  });
});
