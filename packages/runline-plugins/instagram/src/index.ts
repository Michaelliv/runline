/**
 * Instagram plugin for runline, on Meta's Instagram API for professional
 * (Business and Creator) accounts.
 *
 * Reads name the fields they want, as the Graph API does, with a useful
 * default set; rows keep the API's shape. An edge is read a page at a
 * time: a page answers `after` while another follows.
 *
 * Publishing is Meta's three steps, one action each: `container.create`
 * (Meta fetches the media from a public URL, or `container.upload` sends
 * a local video), `container.get` until the container is FINISHED, then
 * `media.publish`.
 *
 * The login is a Meta access token. Which host it works on follows from
 * the login that issued it, and is the connection's `apiHost`: a Facebook
 * Login or Unified Login token on graph.facebook.com, where every call
 * names the Instagram account, or an Instagram Login token on
 * graph.instagram.com, where the account is the token's own.
 */
import {
  answerFailed,
  jsonAnswer,
  pathSegment,
  type RunlinePluginAPI,
} from "runline";
import * as t from "typebox";
import { readLocalFile } from "../../_shared/localFile.js";
import {
  fields,
  names,
  paging,
  snake,
  unixTime,
  url,
} from "../../_shared/metaGraph.js";
import { obj } from "../../_shared/provider.js";
import { atLeastOne, exactlyOne, stringEnum } from "../../_shared/schemas.js";
import {
  apiHost,
  HOSTS,
  type Host,
  instagramCredential,
} from "./credentials.js";
import {
  accountId,
  accountPath,
  edge,
  expansion,
  graph,
  id,
  igUserId,
  node,
  PLUGIN,
  STRICT,
  send,
} from "./shared.js";

type In<S extends t.TSchema> = t.Static<S>;

// ─── Default fields ─────────────────────────────────────────────

/** An account's profile; the two hosts name its fields differently. */
const USER_FIELDS = {
  "graph.facebook.com": [
    "id",
    "username",
    "name",
    "biography",
    "website",
    "followers_count",
    "follows_count",
    "media_count",
    "profile_picture_url",
  ],
  "graph.instagram.com": [
    "user_id",
    "username",
    "name",
    "account_type",
    "followers_count",
    "follows_count",
    "media_count",
    "profile_picture_url",
  ],
} as const satisfies Record<Host, readonly string[]>;
/** The public fields of another professional account. */
const DISCOVERY_FIELDS = [
  "id",
  "username",
  "biography",
  "website",
  "followers_count",
  "media_count",
] as const;
const MEDIA_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_url",
  "permalink",
  "thumbnail_url",
  "timestamp",
  "username",
  "like_count",
  "comments_count",
] as const;
/** A carousel's items carry no caption, permalink or counts of their own. */
const CHILD_FIELDS = [
  "id",
  "media_type",
  "media_url",
  "thumbnail_url",
  "timestamp",
] as const;
const STORY_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_url",
  "permalink",
  "thumbnail_url",
  "timestamp",
] as const;
/** The fields Meta returns for media found by hashtag. */
const HASHTAG_MEDIA_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_url",
  "permalink",
  "timestamp",
  "like_count",
  "comments_count",
] as const;
const CONTAINER_FIELDS = ["id", "status_code", "status"] as const;
const COMMENT_FIELDS = [
  "id",
  "text",
  "timestamp",
  "username",
  "from",
  "like_count",
  "hidden",
  "parent_id",
] as const;
const MENTIONED_COMMENT_FIELDS = [
  "id",
  "text",
  "timestamp",
  "like_count",
  "media",
] as const;
const MENTIONED_MEDIA_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_url",
  "timestamp",
  "username",
  "like_count",
  "comments_count",
] as const;
const HASHTAG_FIELDS = ["id", "name"] as const;
const CONVERSATION_FIELDS = ["messages"] as const;
const MESSAGE_FIELDS = ["id", "created_time", "from", "to", "message"] as const;

// ─── Input schemas ──────────────────────────────────────────────

const mediaId = id("IG Media ID");
const commentId = id("IG Comment ID");
const containerId = id("IG Container ID, as container.create answers it");
const hashtagId = id("IG Hashtag ID, as hashtag.search answers it");
const username = (description: string) =>
  t.String({ pattern: "^[A-Za-z0-9._]{1,30}$", description });
const message = t.String({
  minLength: 1,
  description: "The comment's text",
});

const page = t.Object(paging, STRICT);
/** A page of one of an account's edges. */
const accountEdge = <F extends t.TProperties>(properties: F) =>
  t.Object({ igUserId, ...properties, ...paging }, STRICT);
const accountPage = accountEdge({});
/** What a media edge's fields may expand. */
const EDGES = "An edge takes its own fields: children{id,media_url}";
const REPLIES = "Replies are an edge: replies{id,text,username,timestamp}";

const userGet = t.Object(
  {
    igUserId,
    fields: fields(
      "IG User",
      USER_FIELDS["graph.facebook.com"],
      `On graph.instagram.com the default is ${USER_FIELDS["graph.instagram.com"].join(", ")}`,
    ),
  },
  STRICT,
);
const userInsights = t.Object(
  {
    igUserId,
    metric: names(
      "Metrics: accounts_engaged, comments, follows_and_unfollows, likes, profile_links_taps, reach, replies, reposts, saves, shares, total_interactions, views (period day); engaged_audience_demographics, follower_demographics (period lifetime, with timeframe)",
    ),
    period: stringEnum(["day", "lifetime"] as const, {
      description:
        "day for the interaction metrics, lifetime for the demographics metrics",
    }),
    metricType: t.Optional(
      stringEnum(["total_value", "time_series"] as const, {
        description:
          "total_value answers one total, and takes breakdown; time_series answers a value per period (reach only)",
      }),
    ),
    breakdown: t.Optional(
      names(
        "Split a total_value by: media_product_type, follow_type, contact_button_type; the demographics metrics by age, city, country, gender. A metric that takes no such breakdown fails the whole call",
      ),
    ),
    timeframe: t.Optional(
      stringEnum(["this_week", "this_month"] as const, {
        description:
          "How far back the demographics metrics look, in place of since and until: the last 7 days or the last 30",
      }),
    ),
    since: t.Optional(unixTime("Start of the range (default 24 hours ago)")),
    until: t.Optional(unixTime("End of the range")),
  },
  STRICT,
);
const publishingLimit = t.Object(
  {
    igUserId,
    since: t.Optional(
      unixTime("Count posts since this time, at most 24 hours ago"),
    ),
  },
  STRICT,
);
const businessDiscovery = t.Object(
  {
    igUserId,
    username: username(
      "The other professional account's username, without the @",
    ),
    fields: fields(
      "IG User",
      DISCOVERY_FIELDS,
      "Its media is an edge: media{caption,like_count,comments_count,permalink}",
    ),
  },
  STRICT,
);

const mediaList = accountEdge({
  fields: fields("IG Media", MEDIA_FIELDS, EDGES),
  since: t.Optional(unixTime("Only media created after this time")),
  until: t.Optional(unixTime("Only media created before this time")),
});
const mediaGet = t.Object(
  { mediaId, fields: fields("IG Media", MEDIA_FIELDS, EDGES) },
  STRICT,
);
const mediaChildren = t.Object(
  { mediaId, fields: fields("IG Media", CHILD_FIELDS), ...paging },
  STRICT,
);
const mediaUpdate = t.Object(
  {
    mediaId,
    commentEnabled: t.Boolean({
      description: "true lets people comment on the media, false stops them",
    }),
  },
  STRICT,
);
const mediaOnly = t.Object({ mediaId }, STRICT);
const mediaInsights = t.Object(
  {
    mediaId,
    metric: names(
      "Metrics, by the media's surface. Feed posts: comments, follows, likes, profile_activity, profile_visits, reach, reposts, saved, shares, total_interactions, views. Reels: comments, ig_reels_avg_watch_time, ig_reels_video_view_total_time, likes, reach, reels_skip_rate, reposts, saved, shares, total_interactions, views. Stories: follows, link_clicks, navigation, profile_activity, profile_visits, reach, replies, reposts, shares, total_interactions, views",
    ),
    breakdown: t.Optional(
      names(
        "action_type (with profile_activity only) or story_navigation_action_type (with navigation only)",
      ),
    ),
  },
  STRICT,
);
const mediaPublish = t.Object(
  {
    igUserId,
    creationId: id(
      "ID of the container to publish, once container.get answers status_code FINISHED",
    ),
  },
  STRICT,
);
const storyList = accountEdge({
  fields: fields("IG Media", STORY_FIELDS, EDGES),
});
const isoTime = (description: string) =>
  t.String({
    pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}",
    description: `${description} (ISO 8601: 2026-11-18T09:12:31, UTC without an offset)`,
  });
const tagList = accountEdge({
  fields: fields("IG Media", MEDIA_FIELDS, EDGES),
  mediaType: t.Optional(
    t.Array(stringEnum(["IMAGE", "VIDEO", "CAROUSEL_ALBUM"] as const), {
      minItems: 1,
      description: "Only media of these types",
    }),
  ),
  postedAfter: t.Optional(isoTime("Only media posted after this time")),
  postedBefore: t.Optional(isoTime("Only media posted before this time")),
});

const position = (edge: string) =>
  t.Optional(
    t.Number({
      minimum: 0,
      maximum: 1,
      description: `Distance from the ${edge} edge, as a fraction of the image`,
    }),
  );
const pollOption = t.String({ minLength: 1, maxLength: 25 });
/** Where a container's media comes from: one of these is required. */
const containerSource = {
  imageUrl: t.Optional(
    url(
      "Public URL of a JPEG, at most 8 MiB, for an image post, story or carousel item",
    ),
  ),
  videoUrl: t.Optional(
    url(
      "Public URL of an MOV or MP4, for a reel, a video story or a carousel item",
    ),
  ),
  children: t.Optional(
    t.Array(containerId, {
      minItems: 2,
      maxItems: 20,
      description:
        "With mediaType CAROUSEL: the containers of its items, each created with isCarouselItem",
    }),
  ),
  uploadType: t.Optional(
    stringEnum(["resumable"] as const, {
      description:
        "resumable creates a video container with no URL, for container.upload to fill (graph.facebook.com only)",
    }),
  ),
};
const containerCreate = t.Object(
  {
    igUserId,
    mediaType: t.Optional(
      stringEnum(["REELS", "STORIES", "CAROUSEL", "VIDEO"] as const, {
        description:
          "REELS, STORIES or CAROUSEL; VIDEO for a carousel's video item. Omit for an image post",
      }),
    ),
    ...containerSource,
    isCarouselItem: t.Optional(
      t.Boolean({
        description: "The image or video is one item of a carousel",
      }),
    ),
    caption: t.Optional(
      t.String({
        maxLength: 2200,
        description:
          "Caption, with up to 30 hashtags and 20 @mentions. Not for a carousel's items: set it on the carousel",
      }),
    ),
    altText: t.Optional(
      t.String({
        maxLength: 1000,
        description: "Alternative text for an image; not for reels or stories",
      }),
    ),
    locationId: t.Optional(
      id("ID of a Facebook Page that has a location, to tag the place"),
    ),
    userTags: t.Optional(
      t.Array(
        t.Object(
          {
            username: username("Public Instagram username to tag"),
            x: position("left"),
            y: position("top"),
          },
          STRICT,
        ),
        {
          minItems: 1,
          description:
            "People to tag. An image needs x and y; a story may give them; a video takes none",
        },
      ),
    ),
    collaborators: t.Optional(
      t.Array(username("Instagram username"), {
        minItems: 1,
        maxItems: 3,
        description: "Accounts invited as collaborators; not for stories",
      }),
    ),
    coverUrl: t.Optional(
      url("Reels: public URL of a JPEG cover; it wins over thumbOffset"),
    ),
    thumbOffset: t.Optional(
      t.Integer({
        minimum: 0,
        description:
          "Videos and reels: the frame used as the cover, in milliseconds from the start",
      }),
    ),
    shareToFeed: t.Optional(
      t.Boolean({
        description:
          "Reels: true lets the reel appear in the Feed tab as well as the Reels tab",
      }),
    ),
    audioName: t.Optional(
      t.String({ minLength: 1, description: "Reels: a name for its audio" }),
    ),
    trialParams: t.Optional(
      t.Object(
        {
          graduationStrategy: stringEnum(
            ["MANUAL", "SS_PERFORMANCE"] as const,
            {
              description:
                "MANUAL: shared to followers by hand in the app. SS_PERFORMANCE: shared when the trial performs well",
            },
          ),
        },
        {
          ...STRICT,
          description: "Reels: publish as a trial reel, shown to non-followers",
        },
      ),
    ),
    isAiGenerated: t.Optional(
      t.Boolean({
        description:
          "Label the post as AI-generated. For a carousel, set it on the carousel only",
      }),
    ),
    productTags: t.Optional(
      t.Array(
        t.Object(
          {
            productId: id("Product ID"),
            x: position("left"),
            y: position("top"),
          },
          STRICT,
        ),
        {
          minItems: 1,
          maxItems: 5,
          description:
            "Products to tag (graph.facebook.com only, with an Instagram Shop). An image needs x and y; a video takes none",
        },
      ),
    ),
    brandedContentSponsorIds: t.Optional(
      t.Array(id("Brand's Instagram account ID"), {
        minItems: 1,
        maxItems: 2,
        description:
          "Brands to tag as paid partners (graph.facebook.com only); user.businessDiscovery finds an ID by username",
      }),
    ),
    isPaidPartnership: t.Optional(
      t.Boolean({
        description:
          "Show the Paid partnership label (graph.facebook.com only)",
      }),
    ),
    pollAttachment: t.Optional(
      t.Object(
        {
          optionA: pollOption,
          optionB: pollOption,
          optionC: t.Optional(pollOption),
          optionD: t.Optional(pollOption),
        },
        {
          ...STRICT,
          description:
            "A poll under the post, its question the caption (graph.facebook.com only). optionD needs optionC",
        },
      ),
    ),
    isPollDurationExtended: t.Optional(
      t.Boolean({
        description: "Leave the poll open with no end, in place of its 3 days",
      }),
    ),
    isCommentPromptUsed: t.Optional(
      t.Boolean({
        description:
          "Show the caption as a prompt people answer in the comments (graph.facebook.com only); not with pollAttachment",
      }),
    ),
  },
  { ...STRICT, ...atLeastOne(containerSource) },
);
const containerGet = t.Object(
  {
    containerId,
    fields: fields(
      "IG Container",
      CONTAINER_FIELDS,
      "video_status reports an upload's progress; copyright_check_status a video's copyright check",
    ),
  },
  STRICT,
);
/** The most one signed request carries. */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
/** Where an upload's video comes from. */
const uploadSource = {
  contentPath: t.Optional(
    t.String({
      minLength: 1,
      description: "Local video file, at most 64 MiB",
    }),
  ),
  fileUrl: t.Optional(url("Public URL of the video, for Meta to fetch")),
};
const containerUpload = t.Object(
  { containerId, ...uploadSource },
  { ...STRICT, ...exactlyOne(uploadSource) },
);

const commentList = t.Object(
  { mediaId, fields: fields("IG Comment", COMMENT_FIELDS, REPLIES), ...paging },
  STRICT,
);
const commentGet = t.Object(
  {
    commentId,
    fields: fields("IG Comment", [...COMMENT_FIELDS, "media"], REPLIES),
  },
  STRICT,
);
const commentCreate = t.Object({ mediaId, message }, STRICT);
const commentReplies = t.Object(
  {
    commentId,
    fields: fields("IG Comment", COMMENT_FIELDS, REPLIES),
    ...paging,
  },
  STRICT,
);
const commentReply = t.Object({ commentId, message }, STRICT);
const commentUpdate = t.Object(
  {
    commentId,
    hide: t.Boolean({
      description: "true hides the comment, false shows it again",
    }),
  },
  STRICT,
);
const commentOnly = t.Object({ commentId }, STRICT);

const mentionedComment = t.Object(
  {
    igUserId,
    commentId,
    fields: fields(
      "IG Comment",
      MENTIONED_COMMENT_FIELDS,
      "Its media is an edge: media{id,media_url,permalink}",
    ),
  },
  STRICT,
);
const mentionedMedia = t.Object(
  {
    igUserId,
    mediaId,
    fields: fields("IG Media", MENTIONED_MEDIA_FIELDS, EDGES),
  },
  STRICT,
);
const mentionReply = t.Object(
  {
    igUserId,
    mediaId: id("ID of the media the account is mentioned on"),
    commentId: t.Optional(
      id(
        "ID of the comment that mentions the account; omit to reply to a mention in the caption",
      ),
    ),
    message,
  },
  STRICT,
);

const hashtagSearch = t.Object(
  {
    igUserId,
    q: t.String({
      pattern: "^[^\\s#]+$",
      description: "The hashtag's name, without the #",
    }),
  },
  STRICT,
);
const hashtagGet = t.Object(
  { hashtagId, fields: fields("IG Hashtag", HASHTAG_FIELDS) },
  STRICT,
);
const hashtagMedia = accountEdge({
  hashtagId,
  fields: fields(
    "IG Media",
    HASHTAG_MEDIA_FIELDS,
    "Meta returns only these fields and children for media found by hashtag",
  ),
});

const conversationList = accountEdge({
  userId: t.Optional(
    t.String({
      minLength: 1,
      description:
        "Only the conversation with this person, by their Instagram-scoped ID",
    }),
  ),
});
const conversationGet = t.Object(
  {
    conversationId: t.String({ minLength: 1, description: "Conversation ID" }),
    fields: fields(
      "Conversation",
      CONVERSATION_FIELDS,
      "messages answers each message's id and created_time, newest first",
    ),
  },
  STRICT,
);
const messageGet = t.Object(
  {
    messageId: t.String({ minLength: 1, description: "Message ID" }),
    fields: fields("Message", MESSAGE_FIELDS),
  },
  STRICT,
);
/** Who a message goes to: a person, or a comment's author. */
const recipient = {
  id: t.Optional(
    t.String({
      minLength: 1,
      description: "Instagram-scoped ID of a person who messaged the account",
    }),
  ),
  commentId: t.Optional(
    id(
      "ID of a comment on the account's media: a private reply to its author, once, within 7 days of the comment",
    ),
  ),
};
/** What a message carries: text, or one attachment. */
const messageContent = {
  text: t.Optional(
    t.String({
      minLength: 1,
      maxLength: 1000,
      description: "Text or a link, at most 1000 bytes of UTF-8",
    }),
  ),
  attachment: t.Optional(
    t.Object(
      {
        type: stringEnum(
          [
            "image",
            "audio",
            "video",
            "file",
            "like_heart",
            "MEDIA_SHARE",
          ] as const,
          {
            description:
              "image (PNG or JPEG, 8 MB), audio, video or file (PDF), each 25 MB, by payload.url; like_heart, a heart sticker with no payload; MEDIA_SHARE, one of the account's posts by payload.id",
          },
        ),
        payload: t.Optional(
          t.Object(
            {
              url: t.Optional(url("Public URL of the file")),
              id: t.Optional(id("ID of the account's post to share")),
            },
            STRICT,
          ),
        ),
      },
      STRICT,
    ),
  ),
};
const messageSend = t.Object(
  {
    igUserId,
    recipient: t.Object(recipient, { ...STRICT, ...exactlyOne(recipient) }),
    message: t.Object(messageContent, {
      ...STRICT,
      ...exactlyOne(messageContent),
    }),
    replyTo: t.Optional(
      t.Object(
        {
          mid: t.String({
            minLength: 1,
            description: "ID of the message in the conversation to reply to",
          }),
        },
        STRICT,
      ),
    ),
  },
  STRICT,
);

// ─── Plugin ─────────────────────────────────────────────────────

export default function instagram(rl: RunlinePluginAPI) {
  rl.setName(PLUGIN);
  rl.setVersion("0.1.0");
  rl.setCredential(instagramCredential);

  rl.setConnectionSchema(
    t.Object({
      accessToken: t.String({
        minLength: 1,
        env: "INSTAGRAM_ACCESS_TOKEN",
        description:
          "Meta access token with the Instagram permissions the calls need. A system user token from Unified Login or Business settings need not expire; a user token lasts 60 days",
      }),
      apiHost: t.Optional(
        stringEnum(HOSTS, {
          env: "INSTAGRAM_API_HOST",
          description:
            "graph.facebook.com (default) for a token from Facebook Login or Unified Login; graph.instagram.com for an Instagram User token from Instagram Login",
        }),
      ),
      igUserId: t.Optional(
        id(
          "Instagram professional account the calls are about, unless a call names another (account.list finds it)",
          { env: "INSTAGRAM_USER_ID" },
        ),
      ),
    }),
  );

  // ── Accounts ───────────────────────────────────────

  rl.registerAction("account.list", {
    access: "read",
    description:
      "The Instagram professional accounts the token acts for: those shared with it (a Unified Login or system user token), or on graph.instagram.com the token's own account. A Facebook Login user token reaches accounts through its Pages: page.list.",
    inputSchema: page,
    async execute(input, ctx) {
      if (apiHost(ctx.connection.config) === "graph.instagram.com") {
        const me = obj(
          await graph(ctx, {
            path: "me",
            query: { fields: "user_id,username" },
          }),
        );
        return { data: Array.isArray(me.data) ? me.data : [me] };
      }
      const { limit, after } = input as In<typeof page>;
      return edge(ctx, "me/assigned_instagram_accounts", {
        fields: "id,username",
        limit,
        after,
      });
    },
  });

  rl.registerAction("page.list", {
    access: "read",
    description:
      "The Facebook Pages a Facebook Login user manages, each with the Instagram professional account connected to it (instagram_business_account). graph.facebook.com only.",
    inputSchema: page,
    async execute(input, ctx) {
      const { limit, after } = input as In<typeof page>;
      return edge(ctx, "me/accounts", {
        fields: "id,name,instagram_business_account{id,username}",
        limit,
        after,
      });
    },
  });

  rl.registerAction("user.get", {
    access: "read",
    description:
      "An Instagram professional account's profile: username, name, bio, website, follower, following and media counts.",
    inputSchema: userGet,
    async execute(input, ctx) {
      const { igUserId, fields } = input as In<typeof userGet>;
      return graph(ctx, {
        path: accountPath(ctx, igUserId),
        query: {
          fields: (fields ?? USER_FIELDS[apiHost(ctx.connection.config)]).join(
            ",",
          ),
        },
      });
    },
  });

  rl.registerAction("user.insights", {
    access: "read",
    description:
      "An account's metrics over a period: reach, views, likes, comments, shares, saves, follows and unfollows, and the demographics of its followers and engaged audience. Meta keeps them 90 days, may lag 48 hours, and answers no data for a metric it lacks.",
    inputSchema: userInsights,
    async execute(input, ctx) {
      const { igUserId, metric, metricType, breakdown, ...rest } = input as In<
        typeof userInsights
      >;
      return edge(ctx, `${accountPath(ctx, igUserId)}/insights`, {
        metric: metric.join(","),
        metric_type: metricType,
        breakdown: breakdown?.join(","),
        ...rest,
      });
    },
  });

  rl.registerAction("user.contentPublishingLimit", {
    access: "read",
    description:
      "How many posts the account published through the API in the last 24 hours (quota_usage), and the most it may (config.quota_total).",
    inputSchema: publishingLimit,
    async execute(input, ctx) {
      const { igUserId, since } = input as In<typeof publishingLimit>;
      return edge(
        ctx,
        `${accountPath(ctx, igUserId)}/content_publishing_limit`,
        { fields: "quota_usage,config", since },
      );
    },
  });

  rl.registerAction("user.businessDiscovery", {
    access: "read",
    description:
      "Another Business or Creator account's public profile and media, by its username: follower and media counts, and each post's likes and comments. graph.facebook.com only.",
    inputSchema: businessDiscovery,
    async execute(input, ctx) {
      const { igUserId, username, fields } = input as In<
        typeof businessDiscovery
      >;
      return expansion(
        ctx,
        accountPath(ctx, igUserId),
        { field: "business_discovery", by: "username", value: username },
        fields ?? DISCOVERY_FIELDS,
      );
    },
  });

  // ── Media ──────────────────────────────────────────

  rl.registerAction("media.list", {
    access: "read",
    description:
      "The account's posts and reels, newest first, a page at a time (stories: story.list). Meta lists the 10,000 most recent. media_url is absent for a video with copyrighted audio.",
    inputSchema: mediaList,
    async execute(input, ctx) {
      const { igUserId, fields, ...query } = input as In<typeof mediaList>;
      return edge(ctx, `${accountPath(ctx, igUserId)}/media`, {
        fields: (fields ?? MEDIA_FIELDS).join(","),
        ...query,
      });
    },
  });

  rl.registerAction("media.get", {
    access: "read",
    description:
      "One post, reel or story: its caption, type, URL, permalink, time, and like and comment counts.",
    inputSchema: mediaGet,
    async execute(input, ctx) {
      const { mediaId, fields } = input as In<typeof mediaGet>;
      return node(ctx, mediaId, fields ?? MEDIA_FIELDS);
    },
  });

  rl.registerAction("media.listChildren", {
    access: "read",
    description: "The images and videos of a carousel post.",
    inputSchema: mediaChildren,
    async execute(input, ctx) {
      const { mediaId, fields, ...query } = input as In<typeof mediaChildren>;
      return edge(ctx, `${pathSegment(mediaId)}/children`, {
        fields: (fields ?? CHILD_FIELDS).join(","),
        ...query,
      });
    },
  });

  rl.registerAction("media.update", {
    access: "write",
    description: "Turn comments on a post on or off.",
    inputSchema: mediaUpdate,
    async execute(input, ctx) {
      const { mediaId, commentEnabled } = input as In<typeof mediaUpdate>;
      return graph(ctx, {
        method: "POST",
        path: pathSegment(mediaId),
        query: { comment_enabled: commentEnabled },
      });
    },
  });

  rl.registerAction("media.delete", {
    access: "write",
    description:
      "Delete a post, reel, story or a whole carousel; it cannot be undone. graph.facebook.com only.",
    inputSchema: mediaOnly,
    async execute(input, ctx) {
      const { mediaId } = input as In<typeof mediaOnly>;
      return graph(ctx, { method: "DELETE", path: pathSegment(mediaId) });
    },
  });

  rl.registerAction("media.insights", {
    access: "read",
    description:
      "A post's, reel's or story's lifetime metrics: reach, views, likes, comments, saves, shares and more, by its surface. A story's are kept 24 hours; a carousel's items have none.",
    inputSchema: mediaInsights,
    async execute(input, ctx) {
      const { mediaId, metric, breakdown } = input as In<typeof mediaInsights>;
      return edge(ctx, `${pathSegment(mediaId)}/insights`, {
        metric: metric.join(","),
        breakdown: breakdown?.join(","),
      });
    },
  });

  rl.registerAction("media.publish", {
    access: "write",
    description:
      "Publish a container as a post, reel, story or carousel, and answer the new media's id. The container must be FINISHED (container.get). Meta limits how many an account publishes in 24 hours (user.contentPublishingLimit). config_issue in the answer names a caption or tags the post went out without.",
    inputSchema: mediaPublish,
    async execute(input, ctx) {
      const { igUserId, creationId } = input as In<typeof mediaPublish>;
      return graph(ctx, {
        method: "POST",
        path: `${accountPath(ctx, igUserId)}/media_publish`,
        json: { creation_id: creationId },
      });
    },
  });

  rl.registerAction("story.list", {
    access: "read",
    description:
      "The account's stories of the last 24 hours. Live videos and reshared stories are not listed.",
    inputSchema: storyList,
    async execute(input, ctx) {
      const { igUserId, fields, ...query } = input as In<typeof storyList>;
      return edge(ctx, `${accountPath(ctx, igUserId)}/stories`, {
        fields: (fields ?? STORY_FIELDS).join(","),
        ...query,
      });
    },
  });

  rl.registerAction("tag.list", {
    access: "read",
    description:
      "Public posts by other people that tag the account. A filtered page may come back short or empty while more follow: keep paging while it answers after.",
    inputSchema: tagList,
    async execute(input, ctx) {
      const {
        igUserId,
        fields,
        mediaType,
        postedAfter,
        postedBefore,
        ...query
      } = input as In<typeof tagList>;
      return edge(ctx, `${accountPath(ctx, igUserId)}/tags`, {
        fields: (fields ?? MEDIA_FIELDS).join(","),
        media_type: mediaType?.join(","),
        posted_after: postedAfter,
        posted_before: postedBefore,
        ...query,
      });
    },
  });

  // ── Publishing ─────────────────────────────────────

  rl.registerAction("container.create", {
    access: "write",
    description:
      "The first step of publishing: a container for an image, a reel, a story or a carousel. Meta fetches the media from imageUrl or videoUrl, which must be public; a local video goes through uploadType resumable and container.upload. Answers the container's id (and uri for an upload); wait until container.get answers FINISHED, then media.publish. A carousel is a container whose children are its items' containers. Containers expire after 24 hours.",
    inputSchema: containerCreate,
    async execute(input, ctx) {
      const { igUserId, children, ...parameters } = input as In<
        typeof containerCreate
      >;
      return graph(ctx, {
        method: "POST",
        path: `${accountPath(ctx, igUserId)}/media`,
        json: snake({ ...parameters, children: children?.join(",") }),
      });
    },
  });

  rl.registerAction("container.get", {
    access: "read",
    description:
      "A container's status_code: IN_PROGRESS while Meta processes the media, FINISHED when it can be published, PUBLISHED, ERROR (status names the reason) or EXPIRED. Meta suggests asking once a minute, for at most 5 minutes.",
    inputSchema: containerGet,
    async execute(input, ctx) {
      const { containerId, fields } = input as In<typeof containerGet>;
      return node(ctx, containerId, fields ?? CONTAINER_FIELDS);
    },
  });

  rl.registerAction("container.upload", {
    access: "write",
    description:
      "Send a video to a container created with uploadType resumable: a local file (contentPath), or a public URL Meta fetches (fileUrl). For apps on Facebook Login for Business, on graph.facebook.com.",
    inputSchema: containerUpload,
    async execute(input, ctx) {
      const { containerId, contentPath, fileUrl } = input as In<
        typeof containerUpload
      >;
      const bytes =
        contentPath === undefined
          ? undefined
          : await readLocalFile(contentPath, {
              subject: "instagram: contentPath",
              maxBytes: MAX_UPLOAD_BYTES,
              oversize:
                "instagram: contentPath is larger than 64 MiB; host the video and pass fileUrl, or videoUrl to container.create",
            });
      const response = await send(ctx, {
        target: "upload",
        path: pathSegment(containerId),
        method: "POST",
        ...(bytes
          ? {
              headers: {
                "Content-Type": "application/octet-stream",
                offset: "0",
                file_size: String(bytes.byteLength),
              },
              body: bytes,
            }
          : // The schema requires one of the two, so without a file there is a URL.
            { headers: { file_url: fileUrl as string } }),
      });
      const answer = obj(await jsonAnswer(response));
      if (answer.success !== true)
        throw answerFailed(PLUGIN, { code: obj(answer.debug_info).type });
      return { success: true };
    },
  });

  // ── Comments ───────────────────────────────────────

  rl.registerAction("comment.list", {
    access: "read",
    description:
      "The top-level comments on a post, newest first, at most 50 a page. Replies are an edge: fields replies{id,text,username,timestamp}, or comment.listReplies.",
    inputSchema: commentList,
    async execute(input, ctx) {
      const { mediaId, fields, ...query } = input as In<typeof commentList>;
      return edge(ctx, `${pathSegment(mediaId)}/comments`, {
        fields: (fields ?? COMMENT_FIELDS).join(","),
        ...query,
      });
    },
  });

  rl.registerAction("comment.get", {
    access: "read",
    description:
      "One comment: its text, author, time, likes, whether it is hidden, and the media it is on.",
    inputSchema: commentGet,
    async execute(input, ctx) {
      const { commentId, fields } = input as In<typeof commentGet>;
      return node(ctx, commentId, fields ?? [...COMMENT_FIELDS, "media"]);
    },
  });

  rl.registerAction("comment.create", {
    access: "write",
    description: "Comment on one of the account's posts, as the account.",
    inputSchema: commentCreate,
    async execute(input, ctx) {
      const { mediaId, message } = input as In<typeof commentCreate>;
      return graph(ctx, {
        method: "POST",
        path: `${pathSegment(mediaId)}/comments`,
        query: { message },
      });
    },
  });

  rl.registerAction("comment.listReplies", {
    access: "read",
    description: "The replies to a comment.",
    inputSchema: commentReplies,
    async execute(input, ctx) {
      const { commentId, fields, ...query } = input as In<
        typeof commentReplies
      >;
      return edge(ctx, `${pathSegment(commentId)}/replies`, {
        fields: (fields ?? COMMENT_FIELDS).join(","),
        ...query,
      });
    },
  });

  rl.registerAction("comment.reply", {
    access: "write",
    description:
      "Reply to a comment on the account's media, in public. A reply to a reply joins the top-level comment's thread; a hidden comment takes none. To answer in a direct message, message.send with recipient.commentId.",
    inputSchema: commentReply,
    async execute(input, ctx) {
      const { commentId, message } = input as In<typeof commentReply>;
      return graph(ctx, {
        method: "POST",
        path: `${pathSegment(commentId)}/replies`,
        json: { message },
      });
    },
  });

  rl.registerAction("comment.update", {
    access: "write",
    description:
      "Hide a comment on the account's media, or show it again. The account's own comments always show.",
    inputSchema: commentUpdate,
    async execute(input, ctx) {
      const { commentId, hide } = input as In<typeof commentUpdate>;
      return graph(ctx, {
        method: "POST",
        path: pathSegment(commentId),
        query: { hide },
      });
    },
  });

  rl.registerAction("comment.delete", {
    access: "write",
    description:
      "Delete a comment on the account's media; it cannot be undone.",
    inputSchema: commentOnly,
    async execute(input, ctx) {
      const { commentId } = input as In<typeof commentOnly>;
      return graph(ctx, { method: "DELETE", path: pathSegment(commentId) });
    },
  });

  // ── Mentions ───────────────────────────────────────

  rl.registerAction("mention.getComment", {
    access: "read",
    description:
      "A comment by someone else that @mentions the account, by the comment ID a mentions webhook names; null when there is none.",
    inputSchema: mentionedComment,
    async execute(input, ctx) {
      const { igUserId, commentId, fields } = input as In<
        typeof mentionedComment
      >;
      return expansion(
        ctx,
        accountPath(ctx, igUserId),
        { field: "mentioned_comment", by: "comment_id", value: commentId },
        fields ?? MENTIONED_COMMENT_FIELDS,
      );
    },
  });

  rl.registerAction("mention.getMedia", {
    access: "read",
    description:
      "A post by someone else whose caption @mentions the account, by the media ID a mentions webhook names; null when there is none.",
    inputSchema: mentionedMedia,
    async execute(input, ctx) {
      const { igUserId, mediaId, fields } = input as In<typeof mentionedMedia>;
      return expansion(
        ctx,
        accountPath(ctx, igUserId),
        { field: "mentioned_media", by: "media_id", value: mediaId },
        fields ?? MENTIONED_MEDIA_FIELDS,
      );
    },
  });

  rl.registerAction("mention.reply", {
    access: "write",
    description:
      "Comment, as the account, on someone else's post that @mentions it: on the post for a mention in its caption, or under the comment that mentions it. Not for stories, or for photos the account is only tagged in.",
    inputSchema: mentionReply,
    async execute(input, ctx) {
      const { igUserId, mediaId, commentId, message } = input as In<
        typeof mentionReply
      >;
      return graph(ctx, {
        method: "POST",
        path: `${accountPath(ctx, igUserId)}/mentions`,
        query: { media_id: mediaId, comment_id: commentId, message },
      });
    },
  });

  // ── Hashtags ───────────────────────────────────────

  rl.registerAction("hashtag.search", {
    access: "read",
    description:
      "A hashtag's ID, by its name. An account may query 30 different hashtags in 7 days (hashtag.listRecentlySearched). graph.facebook.com only, for apps with Instagram Public Content Access.",
    inputSchema: hashtagSearch,
    async execute(input, ctx) {
      const { igUserId, q } = input as In<typeof hashtagSearch>;
      return edge(ctx, "ig_hashtag_search", {
        user_id: accountId(ctx, igUserId),
        q,
      });
    },
  });

  rl.registerAction("hashtag.get", {
    access: "read",
    description: "A hashtag's name, by its ID.",
    inputSchema: hashtagGet,
    async execute(input, ctx) {
      const { hashtagId, fields } = input as In<typeof hashtagGet>;
      return node(ctx, hashtagId, fields ?? HASHTAG_FIELDS);
    },
  });

  for (const [action, edgeName, about] of [
    [
      "hashtag.listRecentMedia",
      "recent_media",
      "Public posts with a hashtag from the last 24 hours, not always in order.",
    ],
    [
      "hashtag.listTopMedia",
      "top_media",
      "The most popular public posts with a hashtag.",
    ],
  ] as const)
    rl.registerAction(action, {
      access: "read",
      description: `${about} At most 50 a page, without their authors. Counts as querying the hashtag.`,
      inputSchema: hashtagMedia,
      async execute(input, ctx) {
        const { igUserId, hashtagId, fields, ...query } = input as In<
          typeof hashtagMedia
        >;
        return edge(ctx, `${pathSegment(hashtagId)}/${edgeName}`, {
          user_id: accountId(ctx, igUserId),
          fields: (fields ?? HASHTAG_MEDIA_FIELDS).join(","),
          ...query,
        });
      },
    });

  rl.registerAction("hashtag.listRecentlySearched", {
    access: "read",
    description:
      "The hashtags counting against the account's limit of 30 in 7 days.",
    inputSchema: accountPage,
    async execute(input, ctx) {
      const { igUserId, ...query } = input as In<typeof accountPage>;
      return edge(
        ctx,
        `${accountPath(ctx, igUserId)}/recently_searched_hashtags`,
        query,
      );
    },
  });

  // ── Messages ───────────────────────────────────────

  rl.registerAction("conversation.list", {
    access: "read",
    description:
      "The account's direct-message conversations, each with its id and updated_time, or the one with a given person. Requests untouched for 30 days are not listed.",
    inputSchema: conversationList,
    async execute(input, ctx) {
      const { igUserId, userId, ...query } = input as In<
        typeof conversationList
      >;
      return edge(ctx, `${accountPath(ctx, igUserId)}/conversations`, {
        platform: "instagram",
        user_id: userId,
        ...query,
      });
    },
  });

  rl.registerAction("conversation.get", {
    access: "read",
    description:
      "A conversation's messages, as IDs with their times. message.get reads one; Meta answers details for the 20 most recent only.",
    inputSchema: conversationGet,
    async execute(input, ctx) {
      const { conversationId, fields } = input as In<typeof conversationGet>;
      return node(ctx, conversationId, fields ?? CONVERSATION_FIELDS);
    },
  });

  rl.registerAction("message.get", {
    access: "read",
    description:
      "One direct message: who sent it, to whom, when, and its text.",
    inputSchema: messageGet,
    async execute(input, ctx) {
      const { messageId, fields } = input as In<typeof messageGet>;
      return node(ctx, messageId, fields ?? MESSAGE_FIELDS);
    },
  });

  rl.registerAction("message.send", {
    access: "write",
    description:
      "Send a direct message as the account: text or one attachment, to a person who messaged it within the last 24 hours (recipient.id), or once as a private reply to a comment's author (recipient.commentId). Answers recipient_id and message_id. The account cannot start a conversation.",
    inputSchema: messageSend,
    async execute(input, ctx) {
      const { igUserId, ...body } = input as In<typeof messageSend>;
      return graph(ctx, {
        method: "POST",
        path: `${accountPath(ctx, igUserId)}/messages`,
        json: snake(body),
      });
    },
  });
}
