import { randomUUID } from "node:crypto";
import type { ActionContext } from "runline";
import {
  arr,
  num,
  numOrNull,
  obj,
  pick,
  readBounded,
  seg as segment,
} from "../../_shared/provider.js";

export { arr, num, numOrNull, obj, pick };

/**
 * Transport and credentials for the Wolt consumer surface.
 *
 * Three hosts, two client personas. Catalogue reads are anonymous and go out as
 * the web app; everything authenticated goes out as the mobile app, because the
 * API only accepts the authed calls from a client that looks like the phone.
 */

export const RESTAURANT = "restaurant-api.wolt.com";
export const CONSUMER = "consumer-api.wolt.com";
export const AUTH = "authentication.wolt.com";

export const DEF_LAT = 32.0853;
export const DEF_LON = 34.7818; // TLV
export const AUDIENCE = "restaurant-api";
export const CAPABILITIES = "access_confirmation";

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
/** Renew this long before expiry so an in-flight request never races the clock. */
const EXPIRY_SKEW_MS = 60_000;
const DEFAULT_TOKEN_TTL_MS = 3_600_000;

const WEB_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** Mobile client headers; the authed endpoints reject anything that is not the app. */
const MOBILE: Record<string, string> = {
  "app-language": "en",
  "app-locale": "en-US",
  "client-version": "26.30.4",
  clientversionnumber: "142026304",
  platform: "Android",
  "user-agent": "Wolt/26.30.4; Build/142026304; Android/16; Google sdk_gphone",
};

const WEB: Record<string, string> = {
  "user-agent": WEB_UA,
  "accept-language": "en",
  "app-language": "en",
  platform: "Web",
  "client-version": "1.16.125",
  origin: "https://wolt.com",
  referer: "https://wolt.com/",
};

export type Cfg = {
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  deviceToken?: string;
  visitorId?: string;
  woltSessionId?: string;
  ravelinDeviceId?: string;
  paymentMethodId?: string;
  pendingPhone?: string;
  pendingEmail?: string;
  pendingEmailToken?: string;
  pendingOperationToken?: string;
  pendingConfirmationToken?: string;
  defaultLat?: string | number;
  defaultLon?: string | number;
  allowOrdering?: boolean;
};

export const cfgOf = (ctx: ActionContext): Cfg =>
  (ctx.connection.config || {}) as Cfg;

export const seg = (value: unknown, what: string): string =>
  segment(value, what, "wolt");

/**
 * Normalize a phone to E.164 for Wolt, so a number given the local Israeli way
 * still routes. Handles intl "+972…"/"00972…", national "0500000000", and bare
 * local "500000000" alike. Idempotent.
 */
export function normPhone(input: string): string {
  let digits = String(input).replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2); // intl exit code
  if (digits.startsWith("972")) return `+${digits}`;
  if (digits.startsWith("0")) return `+972${digits.slice(1)}`;
  return `+972${digits}`;
}

export const formEncode = (body: Record<string, unknown>): string =>
  Object.entries(body)
    .map(
      ([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(String(v ?? ""))}`,
    )
    .join("&");

/**
 * A failed request.
 *
 * The body stays private. Wolt puts meaningful data in its 4xx bodies — the
 * login escalation token, `error_code` — so the login flow needs to read it,
 * but those same bodies carry access and refresh tokens. `details()` is the
 * only way in, and the message never contains any of it.
 */
export class WoltError extends Error {
  readonly status: number;
  readonly endpoint: string;
  #body: string;

  constructor(status: number, endpoint: string, body: string) {
    const retired = status === 410 ? " (endpoint retired by Wolt)" : "";
    super(`wolt: request failed (HTTP ${status})${retired} on ${endpoint}`);
    this.name = "WoltError";
    this.status = status;
    this.endpoint = endpoint;
    this.#body = body;
  }

  /** The parsed body, for the branches that must read it. Never logged. */
  details(): Record<string, unknown> {
    try {
      return obj(JSON.parse(this.#body));
    } catch {
      return {};
    }
  }
}

function endpointOf(host: string, path: string): string {
  return `${host}${path.split("?")[0]}`;
}

interface HttpOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Web persona for anonymous catalogue reads; mobile for everything authed. */
  web?: boolean;
}

export async function http(
  host: string,
  path: string,
  opts: HttpOptions = {},
): Promise<Record<string, unknown>> {
  const endpoint = endpointOf(host, path);
  const text = await httpText(host, path, opts);
  // Wolt answers 200 with nothing at all on endpoints it has retired.
  if (!text.trim())
    throw new Error(
      `wolt: ${endpoint} returned an empty body (endpoint retired)`,
    );
  try {
    return obj(JSON.parse(text));
  } catch {
    throw new Error(`wolt: non-JSON response from ${endpoint}`);
  }
}

async function httpText(
  host: string,
  path: string,
  opts: HttpOptions = {},
): Promise<string> {
  const { method = "GET", body = null, headers = {}, web = true } = opts;
  const payload =
    body == null
      ? null
      : typeof body === "string"
        ? body
        : JSON.stringify(body);
  const merged: Record<string, string> = {
    ...(web ? WEB : {}),
    accept: "application/json",
    ...headers,
  };
  if (payload && !merged["content-type"])
    merged["content-type"] = "application/json";
  const endpoint = endpointOf(host, path);
  const res = await fetch(`https://${host}${path}`, {
    method,
    headers: merged,
    body: payload,
    // A redirect would carry the bearer to whatever host the response names.
    redirect: "error",
  });
  const text = await readBounded(
    res,
    MAX_RESPONSE_BYTES,
    () => new Error(`wolt: response exceeded the size limit on ${endpoint}`),
  );
  if (res.status >= 400) throw new WoltError(res.status, endpoint, text);
  return text;
}

// ---------- identity ----------

const ravelinDeviceId = (): string =>
  `rvnand-6-${(randomUUID() + randomUUID()).replace(/-/g, "").toUpperCase().slice(0, 64)}`;

const hex32 = (): string =>
  (randomUUID() + randomUUID()).replace(/-/g, "").slice(0, 32);

/**
 * Device identity, generated once and then persisted. Wolt binds the session and
 * its fraud fingerprint to these, so regenerating them invalidates the login.
 */
export async function ensureIdentity(ctx: ActionContext): Promise<Cfg> {
  const cfg = cfgOf(ctx);
  const patch: Record<string, unknown> = {};
  if (!cfg.visitorId) patch.visitorId = randomUUID();
  if (!cfg.ravelinDeviceId) patch.ravelinDeviceId = ravelinDeviceId();
  if (!cfg.deviceToken) patch.deviceToken = hex32();
  if (!cfg.woltSessionId) patch.woltSessionId = randomUUID();
  if (Object.keys(patch).length) await ctx.updateConnection(patch);
  return cfgOf(ctx);
}

/** Headers every authenticated or login call carries. */
export function clientHeaders(cfg: Cfg): Record<string, string> {
  return {
    ...MOBILE,
    "w-wolt-session-id": cfg.woltSessionId ?? randomUUID(),
    "x-wolt-visitor-id": cfg.visitorId ?? randomUUID(),
  };
}

// ---------- credentials ----------

function fresh(cfg: Cfg): boolean {
  return Boolean(
    cfg.accessToken &&
      cfg.accessTokenExpiresAt &&
      Date.now() < cfg.accessTokenExpiresAt - EXPIRY_SKEW_MS,
  );
}

export function expiresAt(expiresIn: unknown): number {
  const seconds = numOrNull(expiresIn);
  return Date.now() + (seconds ? seconds * 1000 : DEFAULT_TOKEN_TTL_MS);
}

/**
 * The refresh grant. Called only from inside an update owner and always with
 * explicit values, so it can never re-enter the connection store.
 */
async function refreshGrant(cfg: Cfg): Promise<Record<string, unknown>> {
  return http(AUTH, "/v1/wauth2/access_token", {
    method: "POST",
    web: false,
    body: formEncode({
      grant_type: "refresh_token",
      refresh_token: cfg.refreshToken,
      device_token: cfg.deviceToken ?? "",
    }),
    headers: {
      ...clientHeaders(cfg),
      "content-type": "application/x-www-form-urlencoded",
    },
  });
}

export async function accessToken(
  ctx: ActionContext,
  force = false,
): Promise<string> {
  const cfg = await ensureIdentity(ctx);
  if (!cfg.refreshToken)
    throw new Error(
      "wolt: not connected — run the owner login (account.requestEmailCode / account.requestSmsCode / account.redeemLink)",
    );
  if (!force && fresh(cfg)) return cfg.accessToken as string;

  let token: string | undefined;
  // Renewal runs under the store's update ownership so parallel actions coalesce
  // onto one grant. Wolt rotates the refresh token on every grant, so a race here
  // would persist a token the provider has already replaced.
  await ctx.updateConnection(async (current) => {
    const owned = current as Cfg;
    if (!force && fresh(owned)) {
      token = owned.accessToken;
      return undefined;
    }
    const resp = await refreshGrant(owned);
    const issued = pick(resp.access_token);
    if (!issued)
      throw new Error(
        "wolt: token refresh returned no access_token — the refresh token has expired, re-run the owner login",
      );
    token = issued;
    const rotated = pick(resp.refresh_token);
    return {
      accessToken: issued,
      accessTokenExpiresAt: expiresAt(resp.expires_in),
      ...(rotated ? { refreshToken: rotated } : {}),
    };
  });
  if (!token) throw new Error("wolt: token refresh produced no access token");
  return token;
}

export async function authed(
  ctx: ActionContext,
  host: string,
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<Record<string, unknown>> {
  const token = await accessToken(ctx);
  const cfg = cfgOf(ctx);
  return http(host, path, {
    ...opts,
    web: false,
    headers: {
      ...clientHeaders(cfg),
      authorization: `Bearer ${token}`,
      ...(opts.headers ?? {}),
    },
  });
}
