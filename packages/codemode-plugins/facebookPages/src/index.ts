/**
 * Facebook Pages plugin for codemode, on Meta's Pages API: a Page's
 * posts, photos, comments, insights, reviews and settings.
 *
 * The login is a Page access token, and the token is the Page: every
 * action is about the Page it was issued for, which the Graph API
 * addresses as `me`. Posts and comments are made in the Page's voice.
 *
 * Reads name the fields they want, as the Graph API does, with a useful
 * default set; rows keep the API's shape. An edge is read a page at a
 * time: a page answers `after` while another follows.
 */
import { basename } from "node:path";
import {
  type CodemodePluginAPI,
  multipartBody,
  pathSegment,
} from "@shiftlabs/codemode";
import * as t from "typebox";
import { readLocalFile } from "../../_shared/localFile.js";
import {
  fields,
  metaGraph,
  names,
  paging,
  snake,
  unixTime,
  url,
} from "../../_shared/metaGraph.js";
import {
  atLeastOne,
  exactlyOne,
  STRICT,
  stringEnum,
} from "../../_shared/schemas.js";
import { facebookPagesCredential } from "./credentials.js";

const PLUGIN = "facebookPages";

/** What Meta's documented failures mean for the call that got them. */
const HINTS: Record<number, string> = {
  324: "the image is missing or not a valid image file",
  368: "Meta blocked this action as abusive or otherwise disallowed",
  506: "Meta refuses the same post twice in a row; change its content",
  1705: "the comment was not posted; commenting takes a Page access token",
  1609005: "Meta could not read the link; check the URL",
  2069032:
    "this call takes a Page access token; connect the Page's own token, not a person's",
  2874008: "Page insights need a Page with at least 100 followers",
  2932001: "insights are for public posts only",
};

const { request, graph, node, edge } = metaGraph({
  plugin: PLUGIN,
  credential: facebookPagesCredential,
  hints: HINTS,
});

/** The Page the connection's token was issued for. */
const PAGE = "me";

// ─── Default fields ─────────────────────────────────────────────

const PAGE_FIELDS = [
  "id",
  "name",
  "about",
  "category",
  "link",
  "website",
  "fan_count",
  "followers_count",
] as const;
const POST_FIELDS = [
  "id",
  "message",
  "story",
  "created_time",
  "permalink_url",
  "full_picture",
  "status_type",
  "is_published",
  "shares",
] as const;
const COMMENT_FIELDS = [
  "id",
  "message",
  "from",
  "created_time",
  "like_count",
  "comment_count",
  "parent",
] as const;

// ─── Input schemas ──────────────────────────────────────────────

/** A Graph ID: digits, or the parts of a compound one joined by `_`. */
const id = (description: string) =>
  t.String({ pattern: "^\\d+(_\\d+)*$", description });
const postId = id("Page post ID, as {page-id}_{post-id}");
const commentId = id("Comment ID");
const metric = (examples: string) =>
  names(`Metrics, as Meta names them: ${examples}`);
const range = {
  since: t.Optional(unixTime("Start of the range")),
  until: t.Optional(unixTime("End of the range")),
};

/** `published: false`, which a scheduled time needs beside it. */
const SCHEDULED_IS_UNPUBLISHED = {
  anyOf: [
    { not: { required: ["scheduledPublishTime"] } },
    { required: ["published"], properties: { published: { const: false } } },
  ],
};
const publishing = {
  published: t.Optional(
    t.Boolean({
      description:
        "false keeps it out of the feed: scheduled with scheduledPublishTime, or unpublished (default true)",
    }),
  ),
  scheduledPublishTime: t.Optional(
    unixTime(
      "When to publish it, at least 10 minutes from now; with published false",
    ),
  ),
};

const page = t.Object(paging, STRICT);
const pageGet = t.Object({ fields: fields("Page", PAGE_FIELDS) }, STRICT);
const pageInsights = t.Object(
  {
    metric: metric("page_impressions_unique, page_impressions_paid"),
    period: t.Optional(
      stringEnum(["day", "week", "days_28", "lifetime"] as const, {
        description: "The period each value covers (default: every period)",
      }),
    ),
    ...range,
  },
  STRICT,
);
const settingUpdate = t.Object(
  {
    option: t.Record(t.String({ pattern: "^[A-Z][A-Z0-9_]*$" }), t.Boolean(), {
      minProperties: 1,
      description:
        "The setting and its new value, by the name setting.list answers: { USERS_CAN_MESSAGE: true }",
    }),
  },
  STRICT,
);
const blockUser = t.Object(
  {
    user: t.String({
      minLength: 1,
      description:
        "Page-scoped ID of the person, as from.id on their comment or post",
    }),
  },
  STRICT,
);

const postList = t.Object(
  {
    fields: fields(
      "Page post",
      POST_FIELDS,
      "An edge takes its own fields: comments.summary(true).limit(0), attachments{media,url}",
    ),
    ...range,
    ...paging,
  },
  STRICT,
);
const postGet = t.Object(
  { postId, fields: fields("Page post", POST_FIELDS) },
  STRICT,
);
/** What a post is made of: one of these is required. */
const postContent = {
  message: t.Optional(
    t.String({
      minLength: 1,
      description: "The post's text. @[page-id] mentions a Page",
    }),
  ),
  link: t.Optional(url("A URL to attach, shown with its preview")),
  attachedMedia: t.Optional(
    t.Array(
      t.Object({ mediaFbid: id("ID of a photo from photo.create") }, STRICT),
      {
        minItems: 1,
        description:
          "Photos for a multi-photo post, each uploaded by photo.create with published false (and temporary true when the post is scheduled)",
      },
    ),
  ),
};
const postCreate = t.Object(
  { ...postContent, ...publishing },
  { ...STRICT, allOf: [atLeastOne(postContent), SCHEDULED_IS_UNPUBLISHED] },
);
/** What a post update may change: one of these is required. */
const postChanges = {
  message: t.Optional(t.String({ minLength: 1, description: "New text" })),
  isHidden: t.Optional(
    t.Boolean({
      description: "true hides the post from the Page's timeline",
    }),
  ),
  isPublished: t.Optional(
    t.Boolean({ description: "true publishes an unpublished post now" }),
  ),
};
const postUpdate = t.Object(
  { postId, ...postChanges },
  { ...STRICT, ...atLeastOne(postChanges) },
);
const postOnly = t.Object({ postId }, STRICT);
const postInsights = t.Object(
  {
    postId,
    metric: metric(
      "post_reactions_like_total, post_reactions_love_total, post_reactions_wow_total",
    ),
    period: t.Optional(
      stringEnum(["day", "lifetime"] as const, {
        description: "The period each value covers (default lifetime)",
      }),
    ),
    ...range,
  },
  STRICT,
);

/** The most Meta takes for one photo. */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
/** Where a photo comes from. */
const photoSource = {
  url: t.Optional(url("Public URL of the photo, for Meta to fetch")),
  contentPath: t.Optional(
    t.String({
      minLength: 1,
      description:
        "Local photo file (JPEG, PNG, GIF, BMP or TIFF), at most 10 MB",
    }),
  ),
};
const photoCreate = t.Object(
  {
    ...photoSource,
    caption: t.Optional(t.String({ description: "The photo's description" })),
    altTextCustom: t.Optional(
      t.String({ description: "Alternative text for the photo" }),
    ),
    ...publishing,
    temporary: t.Optional(
      t.Boolean({
        description:
          "With published false: keep the photo for a scheduled post's attachedMedia. Meta deletes it after about 24 hours unused",
      }),
    ),
  },
  {
    ...STRICT,
    allOf: [exactlyOne(photoSource), SCHEDULED_IS_UNPUBLISHED],
  },
);

const commentList = t.Object(
  {
    objectId: id("ID of the post, photo or comment whose comments to read"),
    filter: t.Optional(
      stringEnum(["toplevel", "stream"] as const, {
        description:
          "toplevel (default): comments made on the object itself. stream: every comment and reply, oldest first",
      }),
    ),
    summary: t.Optional(
      t.Boolean({
        description: "Also answer summary: the total count and the order",
      }),
    ),
    fields: fields(
      "Comment",
      COMMENT_FIELDS,
      "Replies are an edge: comments{id,message,from,created_time}",
    ),
    ...paging,
  },
  STRICT,
);
const commentGet = t.Object(
  { commentId, fields: fields("Comment", COMMENT_FIELDS) },
  STRICT,
);
/** What a comment is made of: one of these is required. */
const commentContent = {
  message: t.Optional(
    t.String({
      minLength: 1,
      description:
        "The comment's text. @[id] mentions the person or Page that wrote the post or comment, by their Page-scoped ID",
    }),
  ),
  attachmentUrl: t.Optional(url("URL of an image, as a photo comment")),
  attachmentShareUrl: t.Optional(url("URL of a GIF, as a GIF comment")),
  attachmentId: t.Optional(
    id("ID of an unpublished photo, as a photo comment"),
  ),
};
const commentCreate = t.Object(
  {
    objectId: id(
      "ID of the post or photo to comment on, or of the comment to reply to",
    ),
    ...commentContent,
  },
  { ...STRICT, ...atLeastOne(commentContent) },
);
/** What a comment update may change: one of these is required. */
const commentChanges = {
  message: t.Optional(t.String({ minLength: 1, description: "New text" })),
  isHidden: t.Optional(
    t.Boolean({
      description: "true hides the comment, false shows it again",
    }),
  ),
};
const commentUpdate = t.Object(
  { commentId, ...commentChanges },
  { ...STRICT, ...atLeastOne(commentChanges) },
);
const commentOnly = t.Object({ commentId }, STRICT);

// ─── Plugin ─────────────────────────────────────────────────────

export default function facebookPages(rl: CodemodePluginAPI) {
  rl.setName(PLUGIN);
  rl.setVersion("0.1.0");
  rl.setCredential(facebookPagesCredential);

  rl.setConnectionSchema(
    t.Object({
      accessToken: t.String({
        minLength: 1,
        env: "FACEBOOK_PAGE_ACCESS_TOKEN",
        description:
          "Page access token for the Page to act as, with the Pages permissions the calls need. One made from a long-lived user token does not expire",
      }),
    }),
  );

  // ── Page ───────────────────────────────────────────

  rl.registerAction("page.get", {
    access: "read",
    description:
      "The Page's details: name, about, category, link, website, and like and follower counts.",
    inputSchema: pageGet,
    async execute(input, ctx) {
      const { fields } = input;
      return node(ctx, PAGE, fields ?? PAGE_FIELDS);
    },
  });

  rl.registerAction("page.insights", {
    access: "read",
    description:
      "The Page's metrics over time, such as reach and paid impressions. Meta keeps them 2 years, and answers nothing without the read_insights permission.",
    inputSchema: pageInsights,
    async execute(input, ctx) {
      const { metric, ...query } = input;
      return edge(ctx, `${PAGE}/insights`, {
        metric: metric.join(","),
        ...query,
      });
    },
  });

  rl.registerAction("page.blockUser", {
    access: "write",
    description: "Block a person from commenting on the Page.",
    inputSchema: blockUser,
    async execute(input, ctx) {
      return graph(ctx, {
        method: "POST",
        path: `${PAGE}/blocked`,
        json: input,
      });
    },
  });

  rl.registerAction("setting.list", {
    access: "read",
    description:
      "The Page's settings, each a name and whether it is on: USERS_CAN_POST, USERS_CAN_MESSAGE and the rest.",
    inputSchema: page,
    async execute(input, ctx) {
      return edge(ctx, `${PAGE}/settings`, input);
    },
  });

  rl.registerAction("setting.update", {
    access: "write",
    description: "Turn one of the Page's settings on or off.",
    inputSchema: settingUpdate,
    async execute(input, ctx) {
      return graph(ctx, {
        method: "POST",
        path: `${PAGE}/settings`,
        json: input,
      });
    },
  });

  rl.registerAction("role.list", {
    access: "read",
    description:
      "The people who can work on the Page, each with the tasks they may perform.",
    inputSchema: page,
    async execute(input, ctx) {
      return edge(ctx, `${PAGE}/roles`, input);
    },
  });

  rl.registerAction("rating.list", {
    access: "read",
    description:
      "The Page's reviews: each reviewer, whether they recommend it, the text and the time.",
    inputSchema: page,
    async execute(input, ctx) {
      return edge(ctx, `${PAGE}/ratings`, input);
    },
  });

  // ── Posts ──────────────────────────────────────────

  rl.registerAction("post.list", {
    access: "read",
    description:
      "The Page's feed, newest first, at most 100 a page: its own posts, scheduled and unpublished ones included (is_published tells), and posts by visitors.",
    inputSchema: postList,
    async execute(input, ctx) {
      const { fields, ...query } = input;
      return edge(ctx, `${PAGE}/feed`, {
        fields: (fields ?? POST_FIELDS).join(","),
        ...query,
      });
    },
  });

  rl.registerAction("post.listTagged", {
    access: "read",
    description: "Public posts by others that tag the Page.",
    inputSchema: postList,
    async execute(input, ctx) {
      const { fields, ...query } = input;
      return edge(ctx, `${PAGE}/tagged`, {
        fields: (fields ?? POST_FIELDS).join(","),
        ...query,
      });
    },
  });

  rl.registerAction("post.get", {
    access: "read",
    description:
      "One post: its text, time, permalink, picture, type, share count and whether it is published.",
    inputSchema: postGet,
    async execute(input, ctx) {
      const { postId, fields } = input;
      return node(ctx, postId, fields ?? POST_FIELDS);
    },
  });

  rl.registerAction("post.create", {
    access: "write",
    description:
      "Post to the Page as the Page: text, a link, or several photos (attachedMedia), published now, scheduled, or left unpublished. Answers the post's id. A single photo with a caption is photo.create.",
    inputSchema: postCreate,
    async execute(post, ctx) {
      return graph(ctx, {
        method: "POST",
        path: `${PAGE}/feed`,
        json: snake({
          ...post,
          // Meta requires this beside the time when the post has photos.
          unpublishedContentType:
            post.attachedMedia && post.scheduledPublishTime !== undefined
              ? "SCHEDULED"
              : undefined,
        }),
      });
    },
  });

  rl.registerAction("post.update", {
    access: "write",
    description:
      "Change a post's text, hide or show it, or publish an unpublished one. Meta lets an app change only the posts it made.",
    inputSchema: postUpdate,
    async execute(input, ctx) {
      const { postId, ...changes } = input;
      return graph(ctx, {
        method: "POST",
        path: pathSegment(postId),
        json: snake(changes),
      });
    },
  });

  rl.registerAction("post.delete", {
    access: "write",
    description: "Delete a post; it cannot be undone.",
    inputSchema: postOnly,
    async execute(input, ctx) {
      const { postId } = input;
      return graph(ctx, { method: "DELETE", path: pathSegment(postId) });
    },
  });

  rl.registerAction("post.insights", {
    access: "read",
    description:
      "A post's metrics, such as its reactions by kind. For public posts the Page itself made.",
    inputSchema: postInsights,
    async execute(input, ctx) {
      const { postId, metric, ...query } = input;
      return edge(ctx, `${pathSegment(postId)}/insights`, {
        metric: metric.join(","),
        ...query,
      });
    },
  });

  rl.registerAction("photo.create", {
    access: "write",
    description:
      "Add a photo to the Page from a public URL or a local file, as a post with its caption, scheduled, or unpublished for a multi-photo post (post.create attachedMedia). Answers the photo's id, and post_id when it made a post.",
    inputSchema: photoCreate,
    async execute(input, ctx) {
      const { contentPath, ...parameters } = input;
      const path = `${PAGE}/photos`;
      if (contentPath === undefined)
        return graph(ctx, { method: "POST", path, json: snake(parameters) });
      const bytes = await readLocalFile(contentPath, {
        subject: "facebookPages: contentPath",
        maxBytes: MAX_PHOTO_BYTES,
        oversize: "facebookPages: contentPath is larger than 10 MB",
      });
      const form = new FormData();
      for (const [name, value] of Object.entries(
        snake(parameters) as Record<string, unknown>,
      ))
        form.set(name, String(value));
      form.set("source", new Blob([bytes]), basename(contentPath));
      const { body, contentType } = await multipartBody(form);
      return request(ctx, {
        target: "graph",
        path,
        method: "POST",
        body,
        headers: { "Content-Type": contentType },
      });
    },
  });

  // ── Comments ───────────────────────────────────────

  rl.registerAction("comment.list", {
    access: "read",
    description:
      "The comments on a post or photo, or the replies to a comment. Each comment's from.id is its author's Page-scoped ID.",
    inputSchema: commentList,
    async execute(input, ctx) {
      const { objectId, fields, ...query } = input;
      return edge(ctx, `${pathSegment(objectId)}/comments`, {
        fields: (fields ?? COMMENT_FIELDS).join(","),
        ...query,
      });
    },
  });

  rl.registerAction("comment.get", {
    access: "read",
    description:
      "One comment: its text, author, time, like and reply counts, and the comment it replies to.",
    inputSchema: commentGet,
    async execute(input, ctx) {
      const { commentId, fields } = input;
      return node(ctx, commentId, fields ?? COMMENT_FIELDS);
    },
  });

  rl.registerAction("comment.create", {
    access: "write",
    description:
      "Comment as the Page on a post or photo, or reply to a comment: text, an image or a GIF. Answers the comment's id.",
    inputSchema: commentCreate,
    async execute(input, ctx) {
      const { objectId, ...content } = input;
      return graph(ctx, {
        method: "POST",
        path: `${pathSegment(objectId)}/comments`,
        json: snake(content),
      });
    },
  });

  rl.registerAction("comment.update", {
    access: "write",
    description:
      "Change the text of a comment the Page made, or hide or show a comment on the Page.",
    inputSchema: commentUpdate,
    async execute(input, ctx) {
      const { commentId, ...changes } = input;
      return graph(ctx, {
        method: "POST",
        path: pathSegment(commentId),
        json: snake(changes),
      });
    },
  });

  rl.registerAction("comment.delete", {
    access: "write",
    description: "Delete a comment on the Page; it cannot be undone.",
    inputSchema: commentOnly,
    async execute(input, ctx) {
      const { commentId } = input;
      return graph(ctx, { method: "DELETE", path: pathSegment(commentId) });
    },
  });
}
