/**
 * Meta's Graph API, as its plugins call it: one signed request path, a
 * failure read by code and never by message, answers without access
 * tokens, node and edge reads with the fields a call names, and
 * cursor-paged edges.
 */
import {
  type ActionContext,
  AuthError,
  type CredentialCall,
  type CredentialDeclaration,
  credentialRequest,
  errorIdentifier,
  jsonAnswer,
  pathSegment,
  responseFailed,
} from "runline";
import * as t from "typebox";
import { obj } from "./provider.js";

/**
 * The Graph API version a plugin's requests name. Meta retires a version
 * about two years after its release, so this moves forward with the
 * plugins.
 */
export const GRAPH_VERSION = "v27.0";

// ─── Inputs ─────────────────────────────────────────────────────

/**
 * A field name, or an edge expanded with its own fields
 * (`children{id,media_url}`).
 */
const FIELD = "^[A-Za-z0-9_.(){},]+$";

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
      description: "Page size. Meta may answer fewer, and caps each edge",
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

// ─── Answers ────────────────────────────────────────────────────

/**
 * A Graph API answer without Meta access tokens. A Page object carries
 * its own token as `access_token`, whether asked for or as part of its
 * default fields, and a request that sends its token in the query gets it
 * back in every paging link. Neither may reach an action's result.
 */
export function withoutAccessTokens(value: unknown): unknown {
  if (typeof value === "string")
    return value.includes("access_token=")
      ? value.replace(/([?&])access_token=[^&#]*&?/g, "$1").replace(/[?&]$/, "")
      : value;
  if (Array.isArray(value)) return value.map(withoutAccessTokens);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "access_token")
      .map(([key, entry]) => [key, withoutAccessTokens(entry)]),
  );
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

// ─── Requests ───────────────────────────────────────────────────

const UNKNOWN_OUTCOME =
  "The change may have been applied: check before sending it again.";

/** The codes that say the token itself is expired, revoked or invalid. */
const DEAD_TOKEN_CODES = [102, 190];

/**
 * A change carries its parameters the way Meta documents that endpoint:
 * a JSON body where its examples send one, the query string where its
 * syntax is one.
 */
export interface GraphCall {
  method?: "GET" | "POST" | "DELETE";
  /** Beneath the target's base URL. */
  path: string;
  /** Query parameters; undefined ones are skipped. */
  query?: Record<string, unknown>;
  /** A JSON body, in Meta's snake_case names. */
  json?: unknown;
}

export interface Page {
  data: unknown[];
  /** The cursor for the page that follows; absent on the last page. */
  after?: string;
  /** What the edge says of the whole, when the call asks for it. */
  summary?: unknown;
}

export interface MetaGraphOptions {
  plugin: string;
  credential: CredentialDeclaration;
  /**
   * What a failure's subcode, else its code, means for the call that got
   * it: the plugin's own words for the codes Meta documents. A code named
   * here is a failure of the call, never of the token.
   */
  hints?: Record<number, string>;
}

/** A plugin's calls to the Graph API, signed by its credential. */
export function metaGraph(options: MetaGraphOptions) {
  const { plugin, credential, hints = {} } = options;

  /** A hint for a failure: the plugin's, else one for its code's class. */
  function hint(code: unknown, subcode: unknown): string | undefined {
    for (const value of [subcode, code])
      if (typeof value === "number" && hints[value]) return hints[value];
    if (typeof code !== "number") return undefined;
    if (code === 4 || code === 17 || code === 341 || code === 80001)
      return "the call was rate limited; wait before trying again";
    if (code === 10 || (code >= 200 && code <= 299))
      return "the token lacks a permission this call needs";
    return undefined;
  }

  /**
   * A failed response by Meta's error code and subcode (`9007.2207027`)
   * and the fbtrace_id support asks for, with a hint where Meta documents
   * the code. Meta's messages are never read: they can echo what was
   * sent. A dead token is reported as the login it is, and a change
   * answered by a 5xx says its outcome is unknown.
   */
  async function failed(response: Response, changes: boolean): Promise<Error> {
    let error: Record<string, unknown> = {};
    const failure = await responseFailed(plugin, response, (body) => {
      error = obj(obj(body).error);
      const { code, error_subcode: subcode } = error;
      return { code: subcode === undefined ? code : `${code}.${subcode}` };
    });
    const advice = hint(error.code, error.error_subcode);
    const named = [error.error_subcode, error.code].some(
      (value) => typeof value === "number" && hints[value] !== undefined,
    );
    if (!named && DEAD_TOKEN_CODES.includes(error.code as number))
      return new AuthError("reconnect_required", response.status);
    if (advice) failure.message += `: ${advice}`;
    const trace = errorIdentifier(error.fbtrace_id);
    if (trace) failure.message += ` (fbtrace_id ${trace})`;
    if (changes && response.status >= 500)
      failure.message += `. ${UNKNOWN_OUTCOME}`;
    return failure;
  }

  /**
   * A signed call that must succeed. Anything but a GET changes the
   * account, so when such a call gets no answer its outcome is unknown
   * and the failure says so.
   */
  async function send(
    ctx: ActionContext,
    call: CredentialCall,
  ): Promise<Response> {
    const changes = (call.method ?? "GET") !== "GET";
    let response: Response;
    try {
      response = await credentialRequest(ctx, credential, call);
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
   * A signed call's JSON answer, without any access token in it: an ID
   * or a field a caller names can reach a Page, whose answer carries one.
   */
  async function request<T = unknown>(
    ctx: ActionContext,
    call: CredentialCall,
  ): Promise<T> {
    return withoutAccessTokens(await jsonAnswer(await send(ctx, call))) as T;
  }

  /** A call to the `graph` target. */
  function graph<T = unknown>(ctx: ActionContext, call: GraphCall): Promise<T> {
    return request<T>(ctx, { target: "graph", ...call });
  }

  /** A node: one object by its ID, with the fields named. */
  function node(
    ctx: ActionContext,
    nodeId: string,
    fieldList: readonly string[],
  ): Promise<unknown> {
    return graph(ctx, {
      path: pathSegment(nodeId),
      query: { fields: fieldList.join(",") },
    });
  }

  /**
   * A read that is a field expansion of a node, not an edge of its own:
   * `business_discovery.username(bluebottle){followers_count}`. Answers
   * what the expansion found, or null.
   */
  async function expansion(
    ctx: ActionContext,
    path: string,
    call: { field: string; by: string; value: string },
    fieldList: readonly string[],
  ): Promise<unknown> {
    const body = obj(
      await graph(ctx, {
        path,
        query: {
          fields: `${call.field}.${call.by}(${call.value}){${fieldList.join(",")}}`,
        },
      }),
    );
    return body[call.field] ?? null;
  }

  /**
   * One page of an edge, or the whole of one that does not page by
   * cursor (insights), with its summary and without Meta's paging links.
   * A page is followed
   * by another when Meta links to one or, on the edges that never link,
   * when the page has items and a cursor; an edge that pages by cursor
   * ends with an empty page.
   */
  async function edge(
    ctx: ActionContext,
    path: string,
    query: Record<string, unknown>,
  ): Promise<Page> {
    const body = obj(await graph(ctx, { path, query }));
    const data = Array.isArray(body.data) ? body.data : [];
    const links = obj(body.paging);
    const after = obj(links.cursors).after;
    const more = links.next !== undefined || data.length > 0;
    return {
      data,
      ...(typeof after === "string" && after !== "" && more ? { after } : {}),
      ...(body.summary === undefined ? {} : { summary: body.summary }),
    };
  }

  return { send, request, graph, node, expansion, edge };
}
