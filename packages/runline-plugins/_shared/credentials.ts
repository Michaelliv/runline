import {
  type ActionContext,
  AuthError,
  BasicSecretSchema,
  type CredentialDeclaration,
  type CredentialProbe,
  type CredentialTarget,
  type HttpMethod,
  SecretSchema,
} from "runline";
import * as t from "typebox";
import { credentialBroker } from "./credentialAdapter.js";

/**
 * The plugin side of the credential broker, shared by every plugin that
 * signs with a static key: one declaration factory, one way to turn public
 * config into an HTTPS target, one request path. OAuth families keep their
 * own factories (googleCredentials, microsoftCredentials) on the same
 * request path.
 */

/** A flat config field, or a fixed value such as Freshdesk's "X" password. */
type LocalSource = string | { value: string };

type StaticAuth =
  | { kind: "bearer" }
  | { kind: "apiKey"; header: string; prefix?: string }
  | { kind: "queryKey"; param: string };

export interface StaticCredentialSpec {
  /** Credential type id; one per provider, shared by its plugins. */
  id: string;
  auth: StaticAuth | { kind: "basic" };
  /** Where a CLI connection keeps the secret: `secret` for key kinds, `username` and `password` for basic. */
  local: { secret: LocalSource } | { username: LocalSource; password: LocalSource };
  /** Fixed targets, or targets built from public config (hosts, account paths). */
  targets:
    | Record<string, CredentialTarget>
    | ((config: Readonly<Record<string, unknown>>) => Record<string, CredentialTarget>);
  probe?: CredentialProbe;
}

/**
 * A static-key plugin's declaration. The secret lives in one structured
 * `credential` field — `{ secret }`, or `{ username, password }` for basic —
 * and the method is named for the kind, so every static declaration has the
 * same shape. A host stores the structured field; the CLI's flat fields are
 * named by `local`.
 */
export function staticCredential(spec: StaticCredentialSpec): CredentialDeclaration {
  const field = "credential";
  const localSecret = Object.fromEntries(
    Object.entries(spec.local).map(([key, source]: [string, LocalSource]) => [
      key,
      typeof source === "string" ? { field: source } : source,
    ]),
  );
  return (config) => ({
    type: {
      id: spec.id,
      methods: {
        [spec.auth.kind]: {
          schema: t.Object(
            {
              [field]: spec.auth.kind === "basic" ? BasicSecretSchema : SecretSchema,
            },
            { additionalProperties: false },
          ),
          authentication: { ...spec.auth, field },
          targets:
            typeof spec.targets === "function" ? spec.targets(config) : spec.targets,
          ...(spec.probe ? { probe: spec.probe } : {}),
        },
      },
    },
    method: spec.auth.kind,
    localSecret,
  });
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

export interface CredentialCall {
  target: string;
  /** Relative to the target's base URL; may carry its own query. */
  path: string;
  method?: HttpMethod;
  /** Appended to the path's query. Arrays repeat the key; null and undefined are skipped. */
  query?: Record<string, unknown>;
  /** Serialized as the JSON body, with a JSON Content-Type. */
  json?: unknown;
  body?: string | Uint8Array;
  headers?: Record<string, string>;
}

function withQuery(path: string, query: Record<string, unknown> | undefined): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    for (const entry of Array.isArray(value) ? value : [value])
      params.append(key, String(entry));
  }
  const encoded = params.toString();
  if (!encoded) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${encoded}`;
}

/** The one authenticated request path: the host's broker, else the local signer. */
export function credentialRequest(
  ctx: ActionContext,
  declaration: CredentialDeclaration,
  call: CredentialCall,
): Promise<Response> {
  const json = call.json !== undefined;
  return credentialBroker(ctx, declaration).request({
    target: call.target,
    path: withQuery(call.path, call.query),
    method: call.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...call.headers,
    },
    ...(json
      ? { body: JSON.stringify(call.json) }
      : call.body !== undefined
        ? { body: call.body }
        : {}),
  });
}

/**
 * A JSON request. Failure is reported by status alone: provider error text
 * can echo request data back and is not returned to the caller.
 */
export async function credentialJson(
  ctx: ActionContext,
  declaration: CredentialDeclaration,
  plugin: string,
  call: CredentialCall,
): Promise<any> {
  const response = await credentialRequest(ctx, declaration, call);
  if (!response.ok)
    throw new Error(`${plugin}: request failed (HTTP ${response.status})`);
  if (response.status === 204) return { success: true };
  const text = await response.text();
  if (!text) return { success: true };
  try {
    return JSON.parse(text);
  } catch {
    throw new AuthError("invalid_response");
  }
}

/**
 * A next-page URL the API returned, as a path beneath the target. Anything
 * outside the target's exact origin and path prefix is refused rather than
 * followed with the credential attached.
 */
export function pathWithin(baseUrl: string, value: string): string {
  try {
    const base = new URL(baseUrl);
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
