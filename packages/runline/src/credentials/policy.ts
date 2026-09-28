import { AuthError } from "../auth/errors.js";
import type {
  CredentialAuthentication,
  CredentialTarget,
  HttpMethod,
} from "./types.js";

export const HTTP_METHODS: readonly HttpMethod[] = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];

/** The most any target may declare, and any host may allow, per request. */
export const TARGET_TIMEOUT_LIMIT_MS = 60 * 60_000;
export const TARGET_RESPONSE_LIMIT_BYTES = 1024 * 1024 * 1024;

/** A positive integer no larger than `limit`. */
export function bounded(value: unknown, limit: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    (value as number) > 0 &&
    (value as number) <= limit
  );
}

export function headerName(name: string): string {
  if (typeof name !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))
    throw new AuthError("invalid_definition");
  const lower = name.toLowerCase();
  if (
    [
      "host",
      "cookie",
      "set-cookie",
      "content-length",
      "connection",
      "transfer-encoding",
      "proxy-authorization",
      "proxy-connection",
      "upgrade",
      "te",
      "trailer",
    ].includes(lower) ||
    lower.startsWith("sec-") ||
    lower.startsWith("proxy-")
  )
    throw new AuthError("invalid_definition");
  return lower;
}

export function targetBase(target: CredentialTarget): URL {
  try {
    const url = new URL(target.baseUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.endsWith("/")
    )
      throw new Error();
    safePath(url.pathname);
    // Reject normalization rather than silently widening a configured boundary.
    if (url.href !== target.baseUrl) throw new Error();
    return url;
  } catch {
    throw new AuthError("invalid_definition");
  }
}

function controls(value: string): boolean {
  return [...value].some(
    (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127,
  );
}

function safePath(path: string): void {
  // Reject ambiguous encodings and segments before URL normalization. Query values
  // are separate data; encoded URLs in query parameters are not destinations.
  if (/[\\\s]/.test(path) || controls(path)) throw new Error();
  for (const segment of path.split("/")) {
    const decoded = decodeURIComponent(segment);
    if (
      decoded === "." ||
      decoded === ".." ||
      /[%/\\]/.test(decoded) ||
      [...decoded].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    )
      throw new Error();
  }
}

/** Headers a method's authentication sets, lowercased; callers never set them. */
export function injectedHeaders(auth: CredentialAuthentication): string[] {
  if (auth.kind === "none") return [];
  if (auth.kind === "oauth2") return ["authorization"];
  return auth.placements.flatMap((placement) =>
    placement.in === "header"
      ? [headerName(placement.name)]
      : placement.in === "basic"
        ? ["authorization"]
        : [],
  );
}

/**
 * Query parameters a method's authentication sets, a body part's included
 * (it reaches the query when a request has no body); callers never set them.
 */
export function injectedParams(auth: CredentialAuthentication): string[] {
  if (auth.kind !== "static") return [];
  return auth.placements.flatMap((placement) =>
    placement.in === "query" || placement.in === "body" ? [placement.name] : [],
  );
}

/** Body fields a method's authentication sets; callers never set them. */
export function injectedFields(auth: CredentialAuthentication): string[] {
  if (auth.kind !== "static") return [];
  return auth.placements.flatMap((placement) =>
    placement.in === "body" ? [placement.name] : [],
  );
}

/** A request body the transport can add a field to, by its Content-Type. */
export function bodyFormat(headers: Headers): "json" | "form" | undefined {
  const type = headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  return type === "application/json"
    ? "json"
    : type === "application/x-www-form-urlencoded"
      ? "form"
      : undefined;
}

/**
 * The top-level field names of a JSON-object or form body. Anything else —
 * no recognized Content-Type, malformed JSON, a JSON value that is not an
 * object — cannot carry a body part and is refused.
 */
export function bodyFields(headers: Headers, body: Uint8Array): string[] {
  const text = Buffer.from(body).toString();
  const format = bodyFormat(headers);
  if (format === "form") return [...new URLSearchParams(text).keys()];
  if (format === "json") {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new AuthError("request_not_allowed");
    }
    if (value && typeof value === "object" && !Array.isArray(value))
      return Object.keys(value);
  }
  throw new AuthError("request_not_allowed");
}

/**
 * Query parameters only the transport may set: common credential names,
 * and the method's own placed query parameters. Compared
 * case-insensitively, since providers differ in how they match names.
 */
export function refuseCredentialParams(
  url: URL,
  declared: readonly string[],
): void {
  const reserved = [
    "access_token",
    "refresh_token",
    "client_secret",
    "api_key",
    "authorization",
    ...declared.map((name) => name.toLowerCase()),
  ];
  for (const name of url.searchParams.keys())
    if (reserved.includes(name.toLowerCase()))
      throw new AuthError("request_not_allowed");
}

export function resourceUrl(target: CredentialTarget, path: string): URL {
  const base = targetBase(target);
  try {
    if (
      typeof path !== "string" ||
      path.startsWith("/") ||
      path.includes("#") ||
      /^[a-z][a-z0-9+.-]*:/i.test(path) ||
      path.includes("\\") ||
      controls(path)
    )
      throw new Error();
    safePath(path.split("?")[0]);
    const url = new URL(path, base);
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith(base.pathname) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error();
    return url;
  } catch {
    throw new AuthError("request_not_allowed");
  }
}
