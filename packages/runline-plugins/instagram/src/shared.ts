/**
 * The Instagram API's own part of Meta's Graph API: the account a call is
 * about, and what Meta's publishing failures mean.
 */
import { type ActionContext, pathSegment } from "runline";
import * as t from "typebox";
import { metaGraph } from "../../_shared/metaGraph.js";
import { apiHost, instagramCredential } from "./credentials.js";

export const PLUGIN = "instagram";

// ─── Inputs ─────────────────────────────────────────────────────

const NUMERIC_ID = "^\\d+$";
/** A numeric Graph ID: an account, a media object, a comment, a container. */
export const id = (description: string, options: { env?: string } = {}) =>
  t.String({ pattern: NUMERIC_ID, description, ...options });

/** The account a call is about, when it is not the connection's own. */
export const igUserId = t.Optional(
  id(
    "Instagram professional account ID (default: the connection's igUserId; on graph.instagram.com, the token's own account)",
  ),
);

// ─── Accounts ───────────────────────────────────────────────────

/** The account a call names, else the connection's, if either names one. */
function named(ctx: ActionContext, igUserId?: string): unknown {
  const value = igUserId ?? ctx.connection.config.igUserId;
  return value === "" ? undefined : value;
}

/**
 * The ID of the account a call is about. Throws without one: a parameter
 * such as `user_id` takes a real ID, never `me`.
 */
export function accountId(ctx: ActionContext, igUserId?: string): string {
  const value = named(ctx, igUserId);
  if (value === undefined)
    throw new Error(
      "instagram: igUserId is required: pass it, or set it on the connection (account.list finds it)",
    );
  if (typeof value !== "string" || !new RegExp(NUMERIC_ID).test(value))
    throw new Error("instagram: igUserId must be a numeric account ID");
  return value;
}

/**
 * The path segment of the account a call is about. On graph.instagram.com
 * a call that names none is about the token's own account, which that
 * host addresses as `me`; on graph.facebook.com `me` is the Facebook user
 * or system user, so an ID is required.
 */
export function accountPath(ctx: ActionContext, igUserId?: string): string {
  return named(ctx, igUserId) === undefined &&
    apiHost(ctx.connection.config) === "graph.instagram.com"
    ? "me"
    : pathSegment(accountId(ctx, igUserId));
}

// ─── Requests ───────────────────────────────────────────────────

/** What Meta's documented failures mean for the call that got them. */
const HINTS: Record<number, string> = {
  10: "the token lacks a permission this call needs; a story's insights answer this while it has fewer than 5 viewers",
  2207003: "Meta timed out downloading the media; try again",
  2207004: "the image is larger than 8 MiB",
  2207005: "the image format is not supported; only JPEG is",
  2207006: "the media was not found; a permission may be missing",
  2207008: "the container is gone or expired; create a new one",
  2207009: "the image's aspect ratio is outside 4:5 to 1.91:1",
  2207010:
    "the caption is too long: at most 2,200 characters, 30 hashtags and 20 @ tags",
  2207020: "the container expired; create a new one",
  2207026: "the video format is not supported; use MOV or MP4",
  2207027:
    "the container is not ready; wait until container.get answers status_code FINISHED",
  2207042:
    "the account reached its publishing limit for 24 hours (user.contentPublishingLimit)",
  2207050:
    "the Instagram account is restricted; its owner must sign in to Instagram and resolve it",
  2207051: "Meta restricted this action as suspected spam",
  2207052: "Meta could not fetch the media; its URL must be public",
  2207057: "thumbOffset is outside the video's duration",
};

export const { send, graph, node, expansion, edge } = metaGraph({
  plugin: PLUGIN,
  credential: instagramCredential,
  hints: HINTS,
});
