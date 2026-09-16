import { AuthError } from "../auth/errors.js";
import type { CredentialTarget, HttpMethod } from "./types.js";

export const HTTP_METHODS: readonly HttpMethod[] = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];

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
