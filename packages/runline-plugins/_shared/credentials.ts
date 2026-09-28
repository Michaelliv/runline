import {
  type ActionContext,
  AuthError,
  type CredentialDeclaration,
  type CredentialProbe,
  type CredentialTarget,
  type HttpMethod,
  type LocalSecretPart,
  type SecretPlacement,
  staticSecretSchema,
} from "runline";
import * as t from "typebox";
import { credentialBroker } from "./credentialAdapter.js";

/**
 * The plugin side of the credential broker, shared by every plugin that
 * signs with a static key: one declaration factory, one way to turn public
 * config into an HTTPS target, one request path. OAuth families declare
 * through their own factories (googleCredentials, microsoftCredentials).
 */

/**
 * A flat config field, a fixed value such as Freshdesk's "X" password, or
 * the two joined in order, such as Zendesk's `{email}/token` username.
 */
type LocalSource = string | { value: string } | { concat: LocalSecretPart[] };

/**
 * How the secret is placed: a shorthand for a common single-secret case,
 * or the general form of named parts and their placements. The kind names
 * the method, so a stored selection keeps its method name.
 */
type StaticAuth =
  | { kind: "bearer" }
  | { kind: "apiKey"; header: string; prefix?: string }
  | { kind: "queryKey"; param: string }
  | { kind: "basic" }
  | {
      kind: "static";
      parts: string[];
      optionalParts?: string[];
      placements: SecretPlacement[];
    };

/** The parts and placements a shorthand, or the general form, declares. */
function placementsOf(auth: StaticAuth): {
  parts: string[];
  optionalParts?: string[];
  placements: SecretPlacement[];
} {
  if (auth.kind === "static") {
    const { kind: _, ...declared } = auth;
    return declared;
  }
  if (auth.kind === "basic")
    return {
      parts: ["username", "password"],
      placements: [{ in: "basic", username: "username", password: "password" }],
    };
  const placement: SecretPlacement =
    auth.kind === "bearer"
      ? {
          in: "header",
          part: "secret",
          name: "Authorization",
          prefix: "Bearer ",
        }
      : auth.kind === "queryKey"
        ? { in: "query", part: "secret", name: auth.param }
        : {
            in: "header",
            part: "secret",
            name: auth.header,
            ...(auth.prefix === undefined ? {} : { prefix: auth.prefix }),
          };
  return { parts: ["secret"], placements: [placement] };
}

export interface StaticCredentialSpec {
  /** Credential type id; one per provider, shared by its plugins. */
  id: string;
  auth: StaticAuth;
  /**
   * Where a CLI connection keeps each part: `secret` for the single-secret
   * shorthands, `username` and `password` for basic, and one entry per
   * part for the general form.
   */
  local: Record<string, LocalSource>;
  /** Fixed targets, or targets built from public config (hosts, account paths). */
  targets:
    | Record<string, CredentialTarget>
    | ((
        config: Readonly<Record<string, unknown>>,
      ) => Record<string, CredentialTarget>);
  probe?: CredentialProbe;
  /**
   * The credential is optional: a connection signs when it holds the flat
   * secret fields (the CLI) or says `authenticated: true` in its public
   * config (a host that stores the credential), and otherwise sends its
   * requests unsigned through a `none` method — held to the same targets,
   * or to targets of its own where the provider serves unsigned requests
   * elsewhere.
   */
  optional?: true | { targets: Record<string, CredentialTarget> };
}

/**
 * A static-key plugin's declaration. The secret lives in one structured
 * `credential` field — `{ secret }`, `{ username, password }` for basic, or
 * the general form's named parts — and the method is named for the auth
 * kind, so every static declaration has the same shape. A host stores the
 * structured field; the CLI's flat fields are named by `local`.
 */
export function staticCredential(
  spec: StaticCredentialSpec,
): CredentialDeclaration {
  const field = "credential";
  const { parts, optionalParts, placements } = placementsOf(spec.auth);
  if (Object.keys(spec.local).sort().join() !== [...parts].sort().join())
    throw new AuthError("invalid_definition");
  const localSecret = Object.fromEntries(
    Object.entries(spec.local).map(([key, source]: [string, LocalSource]) => [
      key,
      typeof source === "string" ? { field: source } : source,
    ]),
  );
  const fields = Object.values(localSecret).flatMap((source) =>
    ("concat" in source ? source.concat : [source]).flatMap((part) =>
      "field" in part ? [part.field] : [],
    ),
  );
  return (config) => {
    const targets =
      typeof spec.targets === "function" ? spec.targets(config) : spec.targets;
    const signed =
      !spec.optional ||
      config.authenticated === true ||
      fields.every((name) => typeof config[name] === "string" && config[name]);
    return {
      type: {
        id: spec.id,
        methods: {
          [spec.auth.kind]: {
            schema: t.Object(
              { [field]: staticSecretSchema(parts, optionalParts) },
              { additionalProperties: false },
            ),
            authentication: {
              kind: "static",
              field,
              parts,
              ...(optionalParts ? { optionalParts } : {}),
              placements,
            },
            targets,
            ...(spec.probe ? { probe: spec.probe } : {}),
          },
          ...(spec.optional
            ? {
                none: {
                  schema: t.Object({}, { additionalProperties: false }),
                  authentication: { kind: "none" },
                  targets:
                    spec.optional === true ? targets : spec.optional.targets,
                },
              }
            : {}),
        },
      },
      ...(signed
        ? { method: spec.auth.kind, localSecret }
        : { method: "none" }),
    };
  };
}

/**
 * An HTTPS base URL from public config, with `path` appended beneath it.
 * Anything else — plain HTTP, embedded credentials, a query or fragment —
 * is invalid_credentials: the connection cannot be signed as configured.
 */
export function httpsBase(value: unknown, path: string): string {
  try {
    if (typeof value !== "string") throw new Error();
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      value.includes("?") ||
      value.includes("#")
    )
      throw new Error();
    const base = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    return `${url.origin}${base}${path}`;
  } catch {
    throw new AuthError("invalid_credentials");
  }
}

/** One DNS label from public config, for `https://{label}.provider.com/` hosts. */
export function hostLabel(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value)
  )
    throw new AuthError("invalid_credentials");
  return value;
}

/**
 * An ID or name as exactly one path segment, the one encoder every plugin
 * uses. A value that is not one segment is refused rather than encoded: an
 * empty value would address the parent collection (`items/`), a dot segment
 * a sibling, and a separator more than one segment.
 */
export function pathSegment(value: unknown): string {
  const raw = value === undefined || value === null ? "" : String(value);
  if (!raw || raw === "." || raw === ".." || /[/\\]/.test(raw))
    throw new AuthError("request_not_allowed");
  return encodeURIComponent(raw);
}

/**
 * A slash-separated name the API addresses as a sub-path — a model's
 * `owner/name`, a file path, a nested job — each segment by `pathSegment`,
 * its slashes kept.
 */
export function pathSegments(value: unknown): string {
  return String(value ?? "")
    .split("/")
    .map(pathSegment)
    .join("/");
}

/**
 * A slashed name as exactly one segment, its slashes encoded
 * (`@scope/pkg` → `%40scope%2Fpkg`), for a target that declares
 * `encodedSlashes`. An empty or dot piece, or a backslash, is refused.
 */
export function slashEncodedSegment(value: unknown): string {
  return pathSegments(value).replaceAll("/", "%2F");
}

export interface CredentialCall {
  target: string;
  /** Relative to the target's base URL; may carry its own query. */
  path: string;
  method?: HttpMethod;
  /** Appended to the path's query. Arrays repeat the key; null and undefined are skipped. */
  query?: Record<string, unknown>;
  /** Serialized as the JSON body, with a JSON Content-Type. */
  json?: unknown;
  /** Serialized as a form body, by the query's rules, with a form Content-Type. */
  form?: Record<string, unknown>;
  body?: string | Uint8Array;
  headers?: Record<string, string>;
}

/** Parameters as `a=1&b=2`: arrays repeat the key; null and undefined are skipped. */
function encodeParams(params: Record<string, unknown>): string {
  const encoded = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    for (const entry of Array.isArray(value) ? value : [value])
      encoded.append(key, String(entry));
  }
  return encoded.toString();
}

function withQuery(
  path: string,
  query: Record<string, unknown> | undefined,
): string {
  if (!query) return path;
  const encoded = encodeParams(query);
  if (!encoded) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${encoded}`;
}

/** The one authenticated request path: the host's broker, else the local signer. */
export function credentialRequest(
  ctx: ActionContext,
  declaration: CredentialDeclaration,
  call: CredentialCall,
): Promise<Response> {
  const body =
    call.json !== undefined
      ? { type: "application/json", body: JSON.stringify(call.json) }
      : call.form !== undefined
        ? {
            type: "application/x-www-form-urlencoded",
            body: encodeParams(call.form),
          }
        : undefined;
  const payload = body?.body ?? call.body;
  return credentialBroker(ctx, declaration).request({
    target: call.target,
    path: withQuery(call.path, call.query),
    method: call.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": body.type } : {}),
      ...call.headers,
    },
    ...(payload !== undefined ? { body: payload } : {}),
  });
}

/**
 * A provider error identifier worth handing back — an error code, a field
 * path — as a plain name. Anything else is free text, which can echo request
 * data back, and is dropped.
 */
export function errorIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[\w.$-]{1,100}$/.test(value)
    ? value
    : undefined;
}

/**
 * How a failed request reads: the status, and the identifiers a provider
 * returns for correcting the call — its error `code` and the offending
 * `param` — never its free-text message.
 */
export function failureMessage(
  plugin: string,
  status: number,
  detail: { code?: string; param?: string } = {},
): string {
  const parts = [detail.code, detail.param && `param: ${detail.param}`]
    .filter(Boolean)
    .join(", ");
  return `${plugin}: request failed (HTTP ${status}${parts ? ` ${parts}` : ""})`;
}

/** A failed request, reported by status alone. */
export function requestFailed(plugin: string, status: number): Error {
  return new Error(failureMessage(plugin, status));
}

/** A request that must succeed, for callers that read the Response itself (headers, text, bytes). */
export async function credentialOk(
  ctx: ActionContext,
  declaration: CredentialDeclaration,
  plugin: string,
  call: CredentialCall,
): Promise<Response> {
  const response = await credentialRequest(ctx, declaration, call);
  if (!response.ok) throw requestFailed(plugin, response.status);
  return response;
}

/** What a JSON request answers for an empty (or 204) response. */
export type EmptyAnswer = { success: true };

/**
 * A successful response's JSON. `T` is the caller's statement of the
 * answer's shape, unchecked, as for any parsed JSON; without one it is
 * `unknown`. An empty answer is `EmptyAnswer`, so a caller whose endpoint
 * can answer empty includes it in `T`. Every JSON request path reads its
 * answer here, so they cannot disagree about empty or malformed bodies.
 */
export async function jsonAnswer<T = unknown>(response: Response): Promise<T> {
  const empty: EmptyAnswer = { success: true };
  if (response.status === 204) return empty as T;
  const text = await response.text();
  if (!text) return empty as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AuthError("invalid_response");
  }
}

/**
 * A successful response's JSON when its Content-Type says JSON; any other
 * body — a text "OK", nothing at all — is an acknowledgement,
 * `EmptyAnswer`. For APIs whose writes answer without JSON.
 */
export async function jsonOrAcknowledged<T = unknown>(
  response: Response,
): Promise<T | EmptyAnswer> {
  return (response.headers.get("content-type") ?? "").includes(
    "application/json",
  )
    ? jsonAnswer<T>(response)
    : { success: true };
}

/** A JSON request that must succeed; its answer is read by `jsonAnswer`. */
export async function credentialJson<T = unknown>(
  ctx: ActionContext,
  declaration: CredentialDeclaration,
  plugin: string,
  call: CredentialCall,
): Promise<T> {
  return jsonAnswer<T>(await credentialOk(ctx, declaration, plugin, call));
}

/**
 * A next-page URL the API returned, as a path beneath the declared target
 * it will be signed for. Anything outside that target's exact origin and
 * path prefix is refused rather than followed with the credential attached.
 */
export function pathWithin(
  ctx: ActionContext,
  declaration: CredentialDeclaration,
  target: string,
  value: string,
): string {
  const { type, method } = declaration(ctx.connection.config);
  const targets = type.methods[method]?.targets ?? {};
  if (!Object.hasOwn(targets, target))
    throw new AuthError("request_not_allowed");
  try {
    const base = new URL(targets[target].baseUrl);
    const url = new URL(value);
    if (
      url.origin !== base.origin ||
      url.username ||
      url.password ||
      url.hash ||
      !url.pathname.startsWith(base.pathname)
    )
      throw new Error();
    return `${url.pathname.slice(base.pathname.length)}${url.search}`;
  } catch {
    throw new AuthError("request_not_allowed");
  }
}

/** FormData as the buffered bytes the transport accepts, with its boundary. */
export async function multipartBody(
  form: FormData,
): Promise<{ body: Uint8Array; contentType: string }> {
  const response = new Response(form);
  const contentType = response.headers.get("content-type");
  if (!contentType) throw new AuthError("request_not_allowed");
  return { body: new Uint8Array(await response.arrayBuffer()), contentType };
}
