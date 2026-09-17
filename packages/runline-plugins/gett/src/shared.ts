import { randomUUID } from "node:crypto";
import type { ActionContext } from "runline";
import { authedFetch } from "../../_shared/authedFetch.js";
import {
  arr,
  num,
  numOrNull,
  obj,
  pick,
  readBounded,
  seg as segment,
} from "../../_shared/provider.js";
import { coordinatedAccessToken } from "../../_shared/tokenRefresh.js";

export { arr, num, numOrNull, obj, pick };

/**
 * Transport and credentials for the Gett consumer surface.
 *
 * One host, one bearer, one refresh grant. Everything above this file works in
 * terms of `http`/`authed` and never reaches the network itself.
 */

const HOST = "b2cgateway.gett.com";
const UA = "Gett/android/10.48.187";
export const APP_VERSION = "10.48.187";
/** Dizengoff Sq, TLV — a location that always has supply, used when none is given. */
export const DEF_LAT = 32.0779;
export const DEF_LON = 34.7743;

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_TOKEN_TTL_MS = 3_600_000;

export type Cfg = {
  phone?: string;
  refreshToken?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
  deviceId?: string;
  clientDeviceUniqueId?: string;
  deviceGeneratedToken?: string;
  gaid?: string;
  globalUserId?: string | number;
  name?: string;
  creditCardId?: string;
  pendingTempCode?: string;
  defaultLat?: string | number;
  defaultLon?: string | number;
  allowOrdering?: boolean;
};

export const cfgOf = (ctx: ActionContext): Cfg =>
  (ctx.connection.config || {}) as Cfg;

/**
 * Whether a 2xx body reports success.
 *
 * Gett signals refusal inside the body on some endpoints (`rc`) and in a status
 * string on others, and answers 200 either way. An explicit `rc` decides; failing
 * that an explicit status decides; a body carrying neither is an acceptance,
 * because `http` has already rejected every non-2xx. Erring the other way would
 * report a booked ride as unbooked, and the caller would order a second car.
 */
export function accepted(body: Record<string, unknown>): boolean {
  const rc = numOrNull(body.rc);
  if (rc !== null) return rc === 0;
  const status = pick(body.status);
  if (status !== null) return status === "success";
  return true;
}

/**
 * Normalize a phone to Gett's expected international digits (E.164 without '+'),
 * so a number typed the local Israeli way still routes the SMS. Gett pairs the
 * path number with country_phone_prefix:972, so a national "0500000000" (or
 * "050-000-0000") must become "972500000000" — otherwise the challenge returns
 * success but the SMS is silently dropped. Idempotent.
 */
export function normPhone(input: string): string {
  let digits = String(input).replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2); // intl exit code
  if (digits.startsWith("972")) return digits;
  if (digits.startsWith("0")) return `972${digits.slice(1)}`;
  return `972${digits}`;
}

export const seg = (value: unknown, what: string): string =>
  segment(value, what, "gett");

// ---------- HTTP ----------

/** Carries the status for control flow without putting a provider body in the message. */
class GettError extends Error {
  readonly status: number;
  constructor(status: number, endpoint: string) {
    super(`gett: request failed (HTTP ${status}) on ${endpoint}`);
    this.name = "GettError";
    this.status = status;
  }
}

/** The account's phone is in nearly every path; it never belongs in an error. */
function endpointOf(path: string): string {
  return path.split("?")[0].replace(/\/phone\/[^/]+/, "/phone/{phone}");
}

export async function http(
  ctx: ActionContext,
  path: string,
  opts: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<Record<string, unknown>> {
  const cfg = cfgOf(ctx);
  const { method = "GET", body = null, token = null } = opts;
  const payload = body == null ? null : JSON.stringify(body);
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": UA,
    "app-platform": "android",
    "app-version": APP_VERSION,
    "x-device-id": cfg.deviceId || "",
    "x-client-device-unique-id": cfg.clientDeviceUniqueId || "",
    "x-country-code": "IL",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (payload) headers["content-type"] = "application/json; charset=UTF-8";
  const endpoint = endpointOf(path);
  const res = await authedFetch(`https://${HOST}${path}`, {
    method,
    headers,
    body: payload,
  });
  const text = await readBounded(
    res,
    MAX_RESPONSE_BYTES,
    `gett: response exceeded the size limit on ${endpoint}`,
  );
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  // The body can hold tokens, the OTP, or the account holder's details; the
  // status and the redacted endpoint are what a caller can act on.
  if (!res.ok) throw new GettError(res.status, endpoint);
  return obj(parsed);
}

/**
 * Device identity, generated once and then persisted. Gett ties a trusted device
 * to these, so regenerating them would re-trigger the card factor on every login.
 */
export async function ensureDevice(ctx: ActionContext): Promise<void> {
  const cfg = cfgOf(ctx);
  const patch: Record<string, unknown> = {};
  if (!cfg.deviceId) patch.deviceId = randomUUID();
  if (!cfg.clientDeviceUniqueId) patch.clientDeviceUniqueId = randomUUID();
  if (!cfg.deviceGeneratedToken) patch.deviceGeneratedToken = randomUUID();
  if (!cfg.gaid) patch.gaid = randomUUID();
  if (Object.keys(patch).length) await ctx.updateConnection(patch);
}

// ---------- credentials ----------

export function expiresAt(expiresIn: unknown): number {
  const seconds = numOrNull(expiresIn);
  return Date.now() + (seconds ? seconds * 1000 : DEFAULT_TOKEN_TTL_MS);
}

/**
 * The refresh grant itself.
 *
 * `?lc=en` is REQUIRED on every /auth/token call: the app sends it and the server
 * 400s with an empty body without it. Access-token TTL is irrelevant to the grant
 * (a bearer expired by days still refreshes), so a genuine 400 here means the
 * refresh token itself is dead and a fresh owner login is required.
 *
 * Called only from inside an update owner, and always with an explicit token, so
 * it can never re-enter the connection store.
 */
async function refreshGrant(
  ctx: ActionContext,
  cfg: Cfg,
): Promise<Record<string, unknown>> {
  try {
    return await http(
      ctx,
      `/gl/api/v2/phone/${seg(cfg.phone, "phone")}/auth/token?lc=en`,
      {
        method: "POST",
        token: cfg.accessToken || cfg.refreshToken,
        body: { grant_type: "refresh_token", refresh_token: cfg.refreshToken },
      },
    );
  } catch (e) {
    if (e instanceof GettError && e.status === 400) {
      throw new Error(
        "gett: session expired (refresh rejected) — re-run the owner login: account.requestCode -> account.verifyCode -> account.verifyCard",
      );
    }
    throw e;
  }
}

export async function accessToken(
  ctx: ActionContext,
  force = false,
): Promise<string> {
  const cfg = cfgOf(ctx);
  if (!cfg.refreshToken)
    throw new Error(
      "gett: not connected — run account.requestCode({ phone }) -> account.verifyCode({ code }) -> account.verifyCard({ card })",
    );
  if (!cfg.phone) throw new Error("gett: no phone configured");
  // Renewal runs under the store's update ownership, so parallel actions
  // coalesce onto one grant instead of clobbering each other's rotated token.
  return coordinatedAccessToken(
    ctx,
    async (current) => {
      const resp = await refreshGrant(ctx, current as Cfg);
      const issued = pick(resp.access_token);
      if (!issued)
        throw new Error("gett: token refresh returned no access_token");
      const rotated = pick(resp.refresh_token);
      return {
        accessToken: issued,
        accessTokenExpiresAt: expiresAt(resp.expires_in),
        ...(rotated ? { refreshToken: rotated } : {}),
      };
    },
    force,
  );
}

export async function authed(
  ctx: ActionContext,
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<Record<string, unknown>> {
  return http(ctx, path, { ...opts, token: await accessToken(ctx) });
}
