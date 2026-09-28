import { randomUUID } from "node:crypto";
import { type ActionContext, AuthError, type HttpMethod } from "runline";
import { credentialRequest, pathSegment } from "../../_shared/credentials.js";
import { arr, num, numOrNull, obj, pick } from "../../_shared/provider.js";
import { appHeaders, gettCredential } from "./credentials.js";

export { APP_VERSION } from "./credentials.js";
export { arr, num, numOrNull, obj, pick };

/**
 * The Gett consumer surface: one host, one bearer, one refresh grant, all
 * signed through the declared credential. Everything above this file works
 * in terms of `authed` and never reaches the network itself.
 */

/** Dizengoff Sq, TLV — a location that always has supply, used when none is given. */
export const DEF_LAT = 32.0779;
export const DEF_LON = 34.7743;

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
 * because every non-2xx has already been rejected. Erring the other way would
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

/** A configured or caller-supplied value as one path segment; surrounding whitespace is not part of it. */
export const seg = (value: unknown): string =>
  pathSegment(String(value ?? "").trim());

// ---------- HTTP ----------

/** Carries the status for control flow without putting a provider body in the message. */
export class GettError extends Error {
  readonly status: number;
  constructor(status: number, endpoint: string) {
    super(`gett: request failed (HTTP ${status}) on ${endpoint}`);
    this.name = "GettError";
    this.status = status;
  }
}

/** The account's phone is in nearly every path; it never belongs in an error. */
export function endpointOf(path: string): string {
  return path.split("?")[0].replace(/\/phone\/[^/]+/, "/phone/{phone}");
}

/** A 2xx body as an object; anything that is not JSON reads as empty. */
export async function bodyOf(
  res: Response,
  path: string,
): Promise<Record<string, unknown>> {
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  // The body can hold tokens, the OTP, or the account holder's details; the
  // status and the redacted endpoint are what a caller can act on.
  if (!res.ok) throw new GettError(res.status, endpointOf(path));
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

export function expiresAt(expiresIn: unknown): number {
  const seconds = numOrNull(expiresIn);
  return Date.now() + (seconds ? seconds * 1000 : DEFAULT_TOKEN_TTL_MS);
}

/**
 * What a failed renewal means to the owner: no stored login, or a refresh
 * token Gett no longer honours — both mended by the owner login.
 */
function sessionError(error: unknown): unknown {
  if (!(error instanceof AuthError)) return error;
  if (error.code === "invalid_credentials")
    return new Error(
      "gett: not connected — run account.requestCode({ phone }) -> account.verifyCode({ code }) -> account.verifyCard({ card })",
    );
  if (
    error.code === "reconnect_required" ||
    (error.code === "provider_rejected" && error.status === 400)
  )
    return new Error(
      "gett: session expired (refresh rejected) — re-run the owner login: account.requestCode -> account.verifyCode -> account.verifyCard",
    );
  return error;
}

/** A call on the gateway, signed with the session's access token and renewed on demand. */
export async function authed(
  ctx: ActionContext,
  path: string,
  opts: { method?: HttpMethod; body?: unknown } = {},
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await credentialRequest(ctx, gettCredential, {
      target: "api",
      path: path.replace(/^\//, ""),
      method: opts.method ?? "GET",
      headers: appHeaders(ctx.connection.config),
      ...(opts.body == null ? {} : { json: opts.body }),
    });
  } catch (error) {
    throw sessionError(error);
  }
  return bodyOf(res, path);
}
