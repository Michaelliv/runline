import { createHash, createHmac } from "node:crypto";
import type { AwsAccessKey, AwsScope } from "./types.js";

/**
 * AWS Signature Version 4, header form. Pure: no IO, no clock — the
 * caller supplies the signing time, so the canonical request is exactly
 * reproducible and checked against AWS's published test suite.
 */

export interface SigV4Request {
  method: string;
  host: string;
  /** The path exactly as it goes on the wire. */
  path: string;
  /** The query's parameters, decoded, in any order. */
  query: Iterable<[key: string, value: string]>;
  /**
   * Every header the request carries besides Host, in order. A name may
   * repeat; its values are signed joined by commas, as sent.
   */
  headers: Array<[name: string, value: string]>;
  body?: Uint8Array;
}

/** The headers SigV4 adds to a request: each one is the signer's alone. */
export const SIGV4_HEADERS = [
  "authorization",
  "x-amz-date",
  "x-amz-security-token",
  "x-amz-content-sha256",
] as const;

/** The query parameters of a presigned URL; a signed request carries none. */
export const SIGV4_QUERY_PARAMETERS = [
  "X-Amz-Algorithm",
  "X-Amz-Credential",
  "X-Amz-Date",
  "X-Amz-Expires",
  "X-Amz-Security-Token",
  "X-Amz-SignedHeaders",
  "X-Amz-Signature",
] as const;

const ALGORITHM = "AWS4-HMAC-SHA256";

/** RFC 3986 percent-encoding of UTF-8 bytes; unreserved characters stay. */
function uriEncode(value: string, keepSlash: boolean): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const char = String.fromCharCode(byte);
    out +=
      /[A-Za-z0-9\-._~]/.test(char) || (keepSlash && char === "/")
        ? char
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

/**
 * A path as RFC 3986 normalizes it: dot segments resolved, empty segments
 * dropped, a trailing slash kept.
 */
function normalizePath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "..") segments.pop();
    else if (segment && segment !== ".") segments.push(segment);
  }
  const normalized = `/${segments.join("/")}`;
  return path.endsWith("/") && segments.length ? `${normalized}/` : normalized;
}

/**
 * The path as sent, normalized and encoded once more: what every service
 * but S3 signs. S3 signs the path exactly as sent.
 */
function canonicalUri(path: string, service: string): string {
  return service === "s3" ? path || "/" : uriEncode(normalizePath(path), true);
}

/**
 * Parameters re-encoded and sorted by key, then value: the query SigV4
 * signs, and the unambiguous one to send.
 */
export function canonicalQuery(query: Iterable<[string, string]>): string {
  return [...query]
    .map(([key, value]) => [uriEncode(key, false), uriEncode(value, false)])
    .sort(([ak, av], [bk, bv]) =>
      ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0,
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

/** Header values trimmed, inner whitespace runs collapsed, repeats joined. */
function canonicalHeaders(headers: Array<[string, string]>): {
  canonical: string;
  signed: string;
} {
  const values = new Map<string, string[]>();
  for (const [name, value] of headers) {
    const key = name.toLowerCase();
    const list = values.get(key) ?? [];
    list.push(value.trim().replace(/\s+/g, " "));
    values.set(key, list);
  }
  const names = [...values.keys()].sort();
  return {
    canonical: names
      .map((name) => `${name}:${values.get(name)?.join(",")}\n`)
      .join(""),
    signed: names.join(";"),
  };
}

function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** `20150830T123600Z`: the signing time, to the second, in UTC. */
export function amzDate(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/**
 * The canonical request SigV4 signs, with the headers the signer adds
 * to it: `x-amz-date`, the session's `x-amz-security-token`, and for S3
 * the payload hash it requires. Host and every header given are signed.
 */
export function canonicalSigV4Request(
  request: SigV4Request,
  key: AwsAccessKey,
  scope: AwsScope,
  at: Date,
): { canonicalRequest: string; signed: string; added: Record<string, string> } {
  const payloadHash = sha256Hex(request.body ?? new Uint8Array());
  const added: Record<string, string> = {
    "x-amz-date": amzDate(at),
    ...(key.sessionToken ? { "x-amz-security-token": key.sessionToken } : {}),
    ...(scope.service === "s3" ? { "x-amz-content-sha256": payloadHash } : {}),
  };
  const { canonical, signed } = canonicalHeaders([
    ["host", request.host],
    ...request.headers,
    ...Object.entries(added),
  ]);
  const canonicalRequest = [
    request.method,
    canonicalUri(request.path, scope.service),
    canonicalQuery(request.query),
    canonical,
    signed,
    payloadHash,
  ].join("\n");
  return { canonicalRequest, signed, added };
}

/**
 * The headers that sign `request` with `key` for `scope` at `at`: the
 * added headers of `canonicalSigV4Request` and `authorization`. The
 * request must then go out with exactly the headers it was signed with.
 */
export function signSigV4(
  request: SigV4Request,
  key: AwsAccessKey,
  scope: AwsScope,
  at: Date,
): Record<string, string> {
  const { canonicalRequest, signed, added } = canonicalSigV4Request(
    request,
    key,
    scope,
    at,
  );
  const date = added["x-amz-date"];
  const credentialScope = `${date.slice(0, 8)}/${scope.region}/${scope.service}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    date,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = hmac(
    hmac(
      hmac(hmac(`AWS4${key.secretAccessKey}`, date.slice(0, 8)), scope.region),
      scope.service,
    ),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign)
    .digest("hex");
  return {
    ...added,
    authorization: `${ALGORITHM} Credential=${key.accessKeyId}/${credentialScope}, SignedHeaders=${signed}, Signature=${signature}`,
  };
}
