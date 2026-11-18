/**
 * The Instagram API over Meta's Graph API: one signed request path, node
 * and edge reads with the fields a call names, and cursor-paged edges.
 */
import {
  type ActionContext,
  AuthError,
  type CredentialCall,
  credentialRequest,
  errorIdentifier,
  jsonAnswer,
  pathSegment,
  responseFailed,
} from "runline";
import * as t from "typebox";
import { obj } from "../../_shared/provider.js";
import { apiHost, instagramCredential } from "./credentials.js";

export const PLUGIN = "instagram";

// ─── Inputs ─────────────────────────────────────────────────────

export const STRICT = { additionalProperties: false } as const;

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

/** A word in either case, as a pattern: schemas carry no regex flags. */
const anyCase = (word: string) =>
  [...word]
    .map((letter) =>
      /[a-z]/.test(letter) ? `[${letter.toUpperCase()}${letter}]` : letter,
    )
    .join("");
/**
 * A field name, or an edge expanded with its own fields
 * (`children{id,media_url}`). `access_token` is refused: on a Page it
 * answers the Page's token, which no action may return.
 */
const FIELD = `^(?!.*${anyCase("access_token")})[A-Za-z0-9_.(){},]+$`;

/**
 * The fields a read returns, in place of the action's defaults. `note`
 * says what else the caller should know about them.
 */
export const fields = (
  what: string,
  defaults: readonly string[],
  note?: string,
) =>
  t.Optional(
    t.Array(t.String({ pattern: FIELD }), {
      minItems: 1,
      description: `${what} fields to return (default ${defaults.join(", ")})${note ? `. ${note}` : ""}`,
    }),
  );

/** One page of an edge: its size, and the cursor the page before answered. */
export const paging = {
  limit: t.Optional(
    t.Integer({
      minimum: 1,
      description:
        "Page size. Meta may answer fewer, and caps some edges at 50",
    }),
  ),
  after: t.Optional(
    t.String({
      minLength: 1,
      description: "The `after` a page answered, for the page that follows it",
    }),
  ),
};

/** A Unix timestamp in seconds. */
export const unixTime = (description: string) =>
  t.Integer({ minimum: 0, description: `${description} (Unix seconds)` });

// ─── Accounts ───────────────────────────────────────────────────

/**
 * The account a call names, or the connection's. Throws without one: a
 * parameter such as `user_id` takes a real ID, never `me`.
 */
export function accountId(ctx: ActionContext, igUserId?: string): string {
  const value = igUserId ?? ctx.connection.config.igUserId;
  if (value === undefined || value === "")
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
  const named = igUserId ?? ctx.connection.config.igUserId;
  if (
    (named === undefined || named === "") &&
    apiHost(ctx.connection.config) === "graph.instagram.com"
  )
    return "me";
  return pathSegment(accountId(ctx, igUserId));
}

// ─── Requests ───────────────────────────────────────────────────

const UNKNOWN_OUTCOME =
  "The change may have been applied: check before sending it again.";

/** What Meta's documented error subcodes mean for the call that got them. */
const SUBCODE_HINTS: Record<number, string> = {
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

/** A hint for a failure, from its subcode, else from its code's class. */
function hint(code: unknown, subcode: unknown): string | undefined {
  if (typeof subcode === "number" && SUBCODE_HINTS[subcode])
    return SUBCODE_HINTS[subcode];
  if (typeof code !== "number") return undefined;
  if (code === 4 || code === 17 || code === 341)
    return "the call was rate limited; wait before trying again";
  if (code === 10)
    return "the token lacks a permission this call needs; a story's insights answer this while it has fewer than 5 viewers";
  if (code >= 200 && code <= 299)
    return "the token lacks a permission this call needs";
  return undefined;
}

/** The codes that say the token itself is expired, revoked or invalid. */
const DEAD_TOKEN_CODES = [102, 190];

/**
 * A failed response by Meta's error code and subcode (`9007.2207027`) and
 * the fbtrace_id support asks for, with a hint where Meta documents the
 * code. Meta's messages are never read: they can echo what was sent. A
 * dead token is reported as the login it is, and a change answered by a
 * 5xx says its outcome is unknown.
 */
async function failed(response: Response, changes: boolean): Promise<Error> {
  let error: Record<string, unknown> = {};
  const failure = await responseFailed(PLUGIN, response, (body) => {
    error = obj(obj(body).error);
    const { code, error_subcode: subcode } = error;
    return { code: subcode === undefined ? code : `${code}.${subcode}` };
  });
  if (DEAD_TOKEN_CODES.includes(error.code as number))
    return new AuthError("reconnect_required", response.status);
  const advice = hint(error.code, error.error_subcode);
  if (advice) failure.message += `: ${advice}`;
  const trace = errorIdentifier(error.fbtrace_id);
  if (trace) failure.message += ` (fbtrace_id ${trace})`;
  if (changes && response.status >= 500)
    failure.message += `. ${UNKNOWN_OUTCOME}`;
  return failure;
}

/**
 * A signed call that must succeed. Anything but a GET changes the
 * account, so when such a call gets no answer its outcome is unknown and
 * the failure says so.
 */
export async function send(
  ctx: ActionContext,
  call: CredentialCall,
): Promise<Response> {
  const changes = (call.method ?? "GET") !== "GET";
  let response: Response;
  try {
    response = await credentialRequest(ctx, instagramCredential, call);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (!changes || code !== "transport_failed") throw error;
    throw Object.assign(
      new Error(`${(error as Error).message}. ${UNKNOWN_OUTCOME}`, {
        cause: error,
      }),
      { code },
    );
  }
  if (!response.ok) throw await failed(response, changes);
  return response;
}

/**
 * A change carries its parameters the way Meta documents that endpoint:
 * a JSON body where its examples send one, the query string where its
 * syntax is one.
 */
interface GraphCall {
  method?: "GET" | "POST" | "DELETE";
  /** Beneath `https://<host>/<version>/`. */
  path: string;
  /** Query parameters; undefined ones are skipped. */
  query?: Record<string, unknown>;
  /** A JSON body, in Meta's snake_case names. */
  json?: unknown;
}

/** A Graph API call's JSON answer. */
export async function graph<T = unknown>(
  ctx: ActionContext,
  call: GraphCall,
): Promise<T> {
  return jsonAnswer<T>(await send(ctx, { target: "graph", ...call }));
}

/** A node: one object by its ID, with the fields named. */
export function node(
  ctx: ActionContext,
  nodeId: string,
  fieldList: readonly string[],
): Promise<unknown> {
  return graph(ctx, {
    path: pathSegment(nodeId),
    query: { fields: fieldList.join(",") },
  });
}

interface Page {
  data: unknown[];
  /** The cursor for the page that follows; absent on the last page. */
  after?: string;
}

/**
 * One page of an edge, without Meta's paging links. A page is followed
 * by another when Meta links to one or, on the edges that never link
 * (tags), when the page has items and a cursor; an edge that pages by
 * cursor ends with an empty page.
 */
export async function edge(
  ctx: ActionContext,
  path: string,
  query: Record<string, unknown>,
): Promise<Page> {
  const body = obj(await graph(ctx, { path, query }));
  const data = Array.isArray(body.data) ? body.data : [];
  const links = obj(body.paging);
  const after = obj(links.cursors).after;
  const more = links.next !== undefined || data.length > 0;
  return typeof after === "string" && after !== "" && more
    ? { data, after }
    : { data };
}

/**
 * A request body in Meta's names: every key in snake_case, nested ones
 * too, and nothing left undefined.
 */
export function snake(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snake);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        snake(entry),
      ]),
  );
}
