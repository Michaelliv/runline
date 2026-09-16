import { AuthError } from "./errors.js";
import type {
  OAuth2TokenEndpoint,
  OAuthApplication,
  OAuthRuntimeOptions,
  OAuthTokens,
} from "./types.js";

const MAX_RESPONSE_BYTES = 1024 * 1024;

const protectedParameters = new Set([
  "client_id",
  "client_secret",
  "grant_type",
  "code",
  "redirect_uri",
  "refresh_token",
  "code_verifier",
  "state",
  "response_type",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "assertion",
]);

export function providerParameters(
  parameters: Record<string, string> = {},
): Record<string, string> {
  for (const [key, value] of Object.entries(parameters)) {
    if (protectedParameters.has(key) || typeof value !== "string")
      throw new AuthError("invalid_definition");
  }
  return { ...parameters };
}

export function oauthEndpoint(value: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash)
      throw new Error();
    for (const key of url.searchParams.keys()) {
      if (protectedParameters.has(key)) throw new Error();
    }
    return url;
  } catch {
    throw new AuthError("invalid_definition");
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function field(data: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(data, key) ? data[key] : undefined;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value)
    throw new AuthError("invalid_response");
  return value;
}

/** Only normalized grant fields survive decoding; arbitrary response metadata is discarded. */
export function decodeOAuthTokens(
  input: unknown,
  mapping: OAuth2TokenEndpoint["response"] = {},
  now = Date.now(),
): OAuthTokens {
  if (!record(input) || field(input, "error") !== undefined)
    throw new AuthError("invalid_response");
  let data: unknown = input;
  for (const key of mapping.path ?? []) {
    if (!record(data)) throw new AuthError("invalid_response");
    data = field(data, key);
  }
  if (!record(data) || field(data, "error") !== undefined)
    throw new AuthError("invalid_response");
  const accessToken = optionalString(
    field(data, mapping.accessToken ?? "access_token"),
  );
  if (!accessToken) throw new AuthError("invalid_response");
  const refreshToken = optionalString(
    field(data, mapping.refreshToken ?? "refresh_token"),
  );
  const scope = optionalString(field(data, mapping.scope ?? "scope"));
  const tokenType = optionalString(
    field(data, mapping.tokenType ?? "token_type"),
  );
  const expiresIn = field(data, mapping.expiresIn ?? "expires_in");
  let expiresAt: number | undefined;
  if (expiresIn !== undefined) {
    if (
      typeof expiresIn !== "number" ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0
    ) {
      throw new AuthError("invalid_response");
    }
    expiresAt = now + expiresIn * 1000;
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now)
      throw new AuthError("invalid_response");
  }
  const metadata: Array<[string, string]> = [];
  for (const [name, key] of Object.entries(mapping.metadata ?? {})) {
    const value = optionalString(field(data, key));
    if (value !== undefined) metadata.push([name, value]);
  }
  return {
    accessToken,
    ...(metadata.length ? { metadata: Object.fromEntries(metadata) } : {}),
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(scope === undefined ? {} : { scope }),
    ...(tokenType === undefined ? {} : { tokenType }),
  };
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.body) throw new AuthError("invalid_response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        throw new AuthError("invalid_response");
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch {
    throw new AuthError("invalid_response");
  } finally {
    reader.releaseLock();
  }
}

function formValue(value: string): string {
  return new URLSearchParams({ v: value }).toString().slice(2);
}

/**
 * Trusted protocol primitive, not a general authenticated proxy. Hosts approve
 * endpoint definitions and enforce network policy through their transport.
 * No redirects or automatic retries: either can leak or spend a rotating token.
 */
export async function requestOAuth2Token(
  endpoint: OAuth2TokenEndpoint,
  parameters: Record<string, string>,
  application?: OAuthApplication,
  options: Omit<OAuthRuntimeOptions, "onEvent"> = {},
): Promise<OAuthTokens> {
  const url = oauthEndpoint(endpoint.url);
  const mapping = structuredClone(endpoint.response);
  const timeoutMs = options.timeoutMs ?? 20_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw new AuthError("invalid_definition");
  }
  const fields = { ...providerParameters(endpoint.parameters), ...parameters };
  if (Object.values(fields).some((value) => typeof value !== "string"))
    throw new AuthError("invalid_definition");
  if (endpoint.grantType === null) delete fields.grant_type;
  else if (endpoint.grantType !== undefined) {
    if (typeof endpoint.grantType !== "string" || !endpoint.grantType)
      throw new AuthError("invalid_definition");
    fields.grant_type = endpoint.grantType;
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (endpoint.clientAuthentication !== "none") {
    if (
      !application ||
      typeof application.clientId !== "string" ||
      !application.clientId
    ) {
      throw new AuthError("invalid_credentials");
    }
    if ("client_id" in fields || "client_secret" in fields)
      throw new AuthError("invalid_definition");
    if (endpoint.clientAuthentication === "client_id")
      fields.client_id = application.clientId;
    else {
      if (
        typeof application.clientSecret !== "string" ||
        !application.clientSecret
      ) {
        throw new AuthError("invalid_credentials");
      }
      if (endpoint.clientAuthentication === "client_secret_basic") {
        headers.Authorization = `Basic ${Buffer.from(`${formValue(application.clientId)}:${formValue(application.clientSecret)}`).toString("base64")}`;
      } else if (endpoint.clientAuthentication === "client_secret_post") {
        fields.client_id = application.clientId;
        fields.client_secret = application.clientSecret;
      } else throw new AuthError("invalid_definition");
    }
  }
  if (
    endpoint.encoding !== undefined &&
    endpoint.encoding !== "form" &&
    endpoint.encoding !== "json"
  ) {
    throw new AuthError("invalid_definition");
  }
  const json = endpoint.encoding === "json";
  headers["Content-Type"] = json
    ? "application/json"
    : "application/x-www-form-urlencoded";
  // Expiry starts before the request; network latency never extends token lifetime.
  let started: number;
  try {
    started = (options.now ?? Date.now)();
  } catch {
    throw new AuthError("invalid_definition");
  }
  if (!Number.isSafeInteger(started) || started < 0)
    throw new AuthError("invalid_definition");
  let response: Response;
  try {
    response = await (options.fetch ?? globalThis.fetch)(url.toString(), {
      method: "POST",
      headers,
      body: json
        ? JSON.stringify(fields)
        : new URLSearchParams(fields).toString(),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new AuthError("request_failed");
  }
  let data: unknown;
  try {
    data = await responseJson(response);
  } catch {
    if (!response.ok) throw new AuthError("provider_rejected", response.status);
    throw new AuthError("invalid_response");
  }
  if (!response.ok || (record(data) && field(data, "error") !== undefined)) {
    const revoked = record(data) && field(data, "error") === "invalid_grant";
    throw new AuthError(
      revoked ? "reconnect_required" : "provider_rejected",
      response.status,
    );
  }
  return decodeOAuthTokens(data, mapping, started);
}
