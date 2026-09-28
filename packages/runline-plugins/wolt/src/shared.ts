import { randomUUID } from "node:crypto";
import { type ActionContext, AuthError, type HttpMethod } from "runline";
import {
  credentialRequest,
  pathSegment,
  refuseUnderHost,
} from "../../_shared/credentials.js";
import { arr, num, numOrNull, obj, pick } from "../../_shared/provider.js";
import {
  CONSUMER,
  clientHeaders,
  RESTAURANT,
  woltCredential,
} from "./credentials.js";
import { answerOf, endpointOf } from "./public.js";

export {
  AUTH,
  CONSUMER,
  clientHeaders,
  RESTAURANT,
} from "./credentials.js";
export { http, WoltError } from "./public.js";
export { arr, num, numOrNull, obj, pick, refuseUnderHost };

/**
 * The Wolt consumer surface. Catalogue reads are anonymous and go out as
 * the web app (public.ts); everything authenticated goes out as the mobile
 * app, signed through the declared credential, because the API only
 * accepts the authed calls from a client that looks like the phone.
 */

export const DEF_LAT = 32.0853;
export const DEF_LON = 34.7818; // TLV
export const AUDIENCE = "restaurant-api";
export const CAPABILITIES = "access_confirmation";

const DEFAULT_TOKEN_TTL_MS = 3_600_000;

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
  pendingConfirmationToken?: string;
  defaultLat?: string | number;
  defaultLon?: string | number;
  allowOrdering?: boolean;
};

export const cfgOf = (ctx: ActionContext): Cfg =>
  (ctx.connection.config || {}) as Cfg;

/** A configured or caller-supplied value as one path segment; surrounding whitespace is not part of it. */
export const seg = (value: unknown): string =>
  pathSegment(String(value ?? "").trim());

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

// ---------- credentials ----------

export function expiresAt(expiresIn: unknown): number {
  const seconds = numOrNull(expiresIn);
  return Date.now() + (seconds ? seconds * 1000 : DEFAULT_TOKEN_TTL_MS);
}

/**
 * What a failed renewal means to the owner: no stored login, or a refresh
 * token Wolt no longer honours — both mended by the owner login.
 */
function sessionError(error: unknown): unknown {
  if (!(error instanceof AuthError)) return error;
  if (error.code === "invalid_credentials")
    return new Error(
      "wolt: not connected — run the owner login (account.requestEmailCode / account.requestSmsCode / account.redeemLink)",
    );
  if (
    error.code === "reconnect_required" ||
    (error.code === "provider_rejected" &&
      (error.status === 400 || error.status === 401))
  )
    return new Error(
      "wolt: the refresh token has expired — re-run the owner login",
    );
  return error;
}

/** Wolt's signed APIs, by the target each is declared as. */
const TARGETS: Record<string, string> = {
  [RESTAURANT]: "restaurant",
  [CONSUMER]: "consumer",
};

/** A call as the mobile app, signed with the session's access token and renewed on demand. */
export async function authed(
  ctx: ActionContext,
  host: string,
  path: string,
  opts: { method?: HttpMethod; body?: unknown } = {},
): Promise<Record<string, unknown>> {
  const target = Object.hasOwn(TARGETS, host) ? TARGETS[host] : undefined;
  if (!target) throw new AuthError("request_not_allowed");
  const cfg = await ensureIdentity(ctx);
  let res: Response;
  try {
    res = await credentialRequest(ctx, woltCredential, {
      target,
      path: path.replace(/^\//, ""),
      method: opts.method ?? "GET",
      headers: clientHeaders(cfg),
      ...(opts.body == null ? {} : { json: opts.body }),
    });
  } catch (error) {
    throw sessionError(error);
  }
  return answerOf(res.status, endpointOf(host, path), await res.text());
}
