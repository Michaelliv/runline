import { type ActionContext, AuthError, type HttpMethod } from "runline";
import { credentialJson } from "../../_shared/credentials.js";
import { salesforceCredential } from "./credentials.js";

export const DEFAULT_API_VERSION = "v59.0";

export type Ctx = ActionContext;

/** The connection's REST API version, as `vNN.N`; anything else is refused. */
export function apiVersion(ctx: Ctx): string {
  const raw = ctx.connection.config.apiVersion;
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_API_VERSION;
  const version = raw.trim().startsWith("v") ? raw.trim() : `v${raw.trim()}`;
  if (!/^v\d+\.\d+$/.test(version)) throw new AuthError("invalid_credentials");
  return version;
}

/** A request on the org's instance, by a path from its root. */
export function rest(
  ctx: Ctx,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return credentialJson(ctx, salesforceCredential, "salesforce", {
    target: "api",
    path: path.replace(/^\//, ""),
    method,
    query,
    ...(body && Object.keys(body).length > 0 ? { json: body } : {}),
  });
}

/** A REST API request beneath `services/data/<version>`. */
export function api(
  ctx: Ctx,
  method: HttpMethod,
  endpoint: string,
  body?: Record<string, unknown>,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return rest(
    ctx,
    method,
    `services/data/${apiVersion(ctx)}${endpoint}`,
    body,
    query,
  );
}

/** The signed-in user, from the instance's OpenID Connect userinfo endpoint. */
export function identity(ctx: Ctx): Promise<unknown> {
  return rest(ctx, "GET", "services/oauth2/userinfo");
}
