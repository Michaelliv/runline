import type { ActionContext, HttpMethod } from "runline";
import * as t from "typebox";
import { credentialOk, credentialSocketUrl, jsonAnswer, multipartBody } from "../../_shared/credentials.js";
import { steelCredential } from "./auth.js";

export type Ctx = ActionContext;

export type RequestOptions = {
  method?: HttpMethod;
  query?: Record<string, unknown>;
  body?: unknown;
};

/** A REST call: a JSON answer parsed, any other answer (a file) as text. */
export async function api(ctx: Ctx, path: string, options: RequestOptions = {}): Promise<unknown> {
  const query = Object.fromEntries(Object.entries(options.query ?? {}).filter(([, value]) => value !== ""));
  const upload = options.body instanceof FormData ? await multipartBody(options.body) : undefined;
  const res = await credentialOk(ctx, steelCredential, "steel", {
    target: "api",
    path: path.replace(/^\//, ""),
    method: options.method ?? "GET",
    query,
    ...(upload
      ? { body: upload.body, headers: { "Content-Type": upload.contentType } }
      : options.body !== undefined
        ? { json: options.body }
        : {}),
  });
  const type = res.headers.get("content-type") ?? "";
  return res.status === 204 || type.includes("application/json") ? jsonAnswer(res) : res.text();
}

/**
 * The CDP socket URL for a session, from the broker: signed with the key
 * by the local signer, or a relay the host controls. One definition, so
 * no copy builds a key-bearing URL by hand.
 */
export function socketUrl(ctx: Ctx, sessionId: string): Promise<string> {
  return credentialSocketUrl(ctx, steelCredential, { target: "cdp", path: "", query: { sessionId } });
}

export function compactRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null));
}

export const LIST_INPUT_SCHEMA = {
  limit: t.Optional(t.Number({ description: "Maximum number of results when supported" })),
  cursor: t.Optional(t.String({ description: "Pagination cursor when supported" })),
} as const;

export const SESSION_OPTIONS_SCHEMA = {
  timeout: t.Optional(t.Number({ description: "Session hard timeout in milliseconds" })),
  inactivityTimeout: t.Optional(t.Number({ description: "Release after this many milliseconds of inactivity" })),
  useProxy: t.Optional(t.Any({ description: "true for Steel managed proxy, or proxy config object" })),
  solveCaptcha: t.Optional(t.Boolean({ description: "Enable CAPTCHA detection/solving" })),
  region: t.Optional(t.String({ description: "Steel region, e.g. lax or iad" })),
  namespace: t.Optional(t.String({ description: "Credential namespace to use for this session" })),
  userAgent: t.Optional(t.String({ description: "Custom browser user agent" })),
  dimensions: t.Optional(t.Any({ description: "Viewport dimensions, e.g. { width: 1280, height: 768 }" })),
  stealthConfig: t.Optional(t.Any({ description: "Steel stealth configuration, e.g. { autoCaptchaSolving: false }" })),
  deviceConfig: t.Optional(t.Any({ description: "Device config, e.g. { device: 'mobile' }" })),
  profileId: t.Optional(t.String({ description: "Profile ID to load" })),
  persistProfile: t.Optional(t.Boolean({ description: "Persist profile changes on release" })),
  credentials: t.Optional(t.Any({ description: "Credentials injection options, or {} to enable defaults" })),
  extensionIds: t.Optional(t.Array(t.String(), { description: "Extension IDs to attach, or ['all_ext']" })),
  sessionContext: t.Optional(t.Any({ description: "Captured session context to restore" })),
  isSelenium: t.Optional(t.Boolean({ description: "Provision a Selenium-compatible session" })),
} as const;
