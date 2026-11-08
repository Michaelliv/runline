import { isIP } from "node:net";
import type { StoredCookie } from "./types.js";

/**
 * A cookie jar for one connection, after RFC 6265 §5: what a `Set-Cookie`
 * stores, replaces or deletes, and which cookies a request carries. Pure:
 * the transport decides which responses reach it (only its targets') and
 * persists what it answers.
 */

/** The most cookies a jar keeps; the oldest go first beyond it. */
export const MAX_COOKIES = 64;
/** The largest name plus value a cookie may have (RFC 6265 §6.1's floor). */
export const MAX_COOKIE_BYTES = 4096;

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** A cookie name: an RFC 7230 token. */
export function isCookieName(name: unknown): name is string {
  return typeof name === "string" && TOKEN.test(name);
}

/** A value safe to send back in a Cookie header: printable ASCII without `;`. */
function cookieValue(value: string): boolean {
  return /^[\x20-\x3a\x3c-\x7e]*$/.test(value);
}

function domainMatch(host: string, domain: string): boolean {
  return host === domain || (host.endsWith(`.${domain}`) && !isIP(host));
}

/** RFC 6265 §5.1.4: the directory of the request path. */
function defaultPath(pathname: string): string {
  if (!pathname.startsWith("/")) return "/";
  const last = pathname.lastIndexOf("/");
  return last <= 0 ? "/" : pathname.slice(0, last);
}

function pathMatch(requestPath: string, cookiePath: string): boolean {
  return (
    requestPath === cookiePath ||
    (requestPath.startsWith(cookiePath) &&
      (cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/"))
  );
}

/**
 * One `Set-Cookie` from a response to `url`: the cookie it stores, with
 * `expired` when it deletes (Max-Age ≤ 0, or an Expires in the past).
 * Undefined for one a jar ignores: no name, a value or name it cannot
 * send back, an oversized one, or a Domain the host does not match.
 */
export function parseSetCookie(
  header: string,
  url: URL,
  now: number,
): { cookie: StoredCookie; expired: boolean } | undefined {
  const [pair, ...attributes] = header.split(";");
  const equals = pair.indexOf("=");
  if (equals < 0) return undefined;
  const name = pair.slice(0, equals).trim();
  const value = pair.slice(equals + 1).trim();
  if (
    !isCookieName(name) ||
    !cookieValue(value) ||
    name.length + value.length > MAX_COOKIE_BYTES
  )
    return undefined;
  const host = url.hostname.toLowerCase();
  let domain: string | undefined;
  let path: string | undefined;
  let maxAge: number | undefined;
  let expires: number | undefined;
  let secure = false;
  let httpOnly = false;
  for (const attribute of attributes) {
    const at = attribute.indexOf("=");
    const key = (at < 0 ? attribute : attribute.slice(0, at))
      .trim()
      .toLowerCase();
    const raw = at < 0 ? "" : attribute.slice(at + 1).trim();
    if (key === "max-age" && /^-?\d+$/.test(raw)) maxAge = Number(raw);
    else if (key === "expires") {
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) expires = parsed;
    } else if (key === "domain" && raw) {
      domain = raw.replace(/^\./, "").toLowerCase();
    } else if (key === "path") path = raw.startsWith("/") ? raw : undefined;
    else if (key === "secure") secure = true;
    else if (key === "httponly") httpOnly = true;
  }
  // A Domain the host does not match is refused, and so is a bare
  // top-level label: nothing may set a cookie for a whole suffix.
  if (
    domain !== undefined &&
    (!domainMatch(host, domain) || (domain !== host && !domain.includes(".")))
  )
    return undefined;
  const expiresAt =
    maxAge !== undefined
      ? maxAge <= 0
        ? 0
        : Math.min(now + maxAge * 1000, Number.MAX_SAFE_INTEGER)
      : expires;
  const cookie: StoredCookie = {
    name,
    value,
    domain: domain ?? host,
    hostOnly: domain === undefined,
    path: path ?? defaultPath(url.pathname),
    secure,
    httpOnly,
    ...(expiresAt !== undefined ? { expiresAt: Math.max(0, expiresAt) } : {}),
  };
  return { cookie, expired: expiresAt !== undefined && expiresAt <= now };
}

/** The cookies still alive at `now`. */
export function liveCookies(
  cookies: readonly StoredCookie[],
  now: number,
): StoredCookie[] {
  return cookies.filter(
    (cookie) => cookie.expiresAt === undefined || cookie.expiresAt > now,
  );
}

/**
 * The jar after a response to `url` set `headers`: each cookie replaces
 * the one of the same name, domain and path, a deletion removes it, and
 * expired cookies are dropped. At most `MAX_COOKIES`, newest kept.
 */
export function applySetCookies(
  cookies: readonly StoredCookie[],
  headers: readonly string[],
  url: URL,
  now: number,
): StoredCookie[] {
  let jar = liveCookies(cookies, now);
  for (const header of headers) {
    const parsed = parseSetCookie(header, url, now);
    if (!parsed) continue;
    const { cookie, expired } = parsed;
    jar = jar.filter(
      (kept) =>
        kept.name !== cookie.name ||
        kept.domain !== cookie.domain ||
        kept.path !== cookie.path,
    );
    if (!expired) jar.push(cookie);
  }
  return jar.slice(-MAX_COOKIES);
}

/** The cookies a request to `url` carries, longest path first. */
function matching(
  cookies: readonly StoredCookie[],
  url: URL,
  now: number,
): StoredCookie[] {
  const host = url.hostname.toLowerCase();
  return liveCookies(cookies, now)
    .filter(
      (cookie) =>
        (cookie.hostOnly
          ? host === cookie.domain
          : domainMatch(host, cookie.domain)) &&
        pathMatch(url.pathname, cookie.path) &&
        (!cookie.secure || url.protocol === "https:"),
    )
    .sort((a, b) => b.path.length - a.path.length);
}

/** The Cookie header for a request to `url`, or undefined when none match. */
export function cookieHeader(
  cookies: readonly StoredCookie[],
  url: URL,
  now: number,
): string | undefined {
  const sent = matching(cookies, url, now);
  return sent.length
    ? sent.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")
    : undefined;
}

/** The value of cookie `name` a request to `url` would carry. */
export function cookieFor(
  cookies: readonly StoredCookie[],
  name: string,
  url: URL,
  now: number,
): string | undefined {
  return matching(cookies, url, now).find((cookie) => cookie.name === name)
    ?.value;
}
