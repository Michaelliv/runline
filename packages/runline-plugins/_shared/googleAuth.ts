import {
  type ActionContext,
  AuthError,
  downloadResource,
  type HttpMethod,
} from "runline";
import { credentialBroker, credentialRuntime } from "./credentialAdapter.js";
import {
  type GoogleAuthConfig,
  googleCredential,
  googleIdentity,
  googleMethod,
  googleResources,
} from "./googleCredentials.js";

export type { GoogleAuthConfig } from "./googleCredentials.js";
export { googleCredential } from "./googleCredentials.js";

/** Explicit storage adapter: the registry owns token protocols and renewal. */
export function googleRuntime(
  ctx: ActionContext,
  pluginName: string,
  scopes: string[],
) {
  const selection = googleCredential(pluginName, scopes)(ctx.connection.config);
  return credentialRuntime(ctx, selection, (current) => {
    const cfg = current as GoogleAuthConfig;
    return [
      pluginName,
      scopes,
      googleMethod(cfg),
      ...(selection.method === "serviceAccount"
        ? [googleIdentity(cfg)]
        : [cfg.clientId, cfg.clientSecret]),
    ];
  });
}

/** The local signer's token, for trusted in-process callers only: a brokered
 *  host holds none to hand out. Resource consumers use googleResponse. */
export async function googleAccessToken(
  ctx: ActionContext,
  pluginName: string,
  scopes: string[],
): Promise<string> {
  const { binding, transport } = googleRuntime(ctx, pluginName, scopes);
  return transport.accessToken(binding);
}

/** Translate builtin absolute URLs at one boundary; validate the raw path before URL normalization. */
export async function googleResponse(
  ctx: ActionContext,
  plugin: string,
  scopes: string[],
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
  } = {},
  query?: Record<string, unknown>,
): Promise<Response> {
  const resources = googleResources(plugin);
  const selected = Object.entries(resources.targets).find(([, target]) =>
    url.startsWith(target.baseUrl),
  );
  if (!selected) throw new AuthError("request_not_allowed");
  const [target, policy] = selected;
  let path = url.slice(policy.baseUrl.length);
  if (query) {
    const separator = path.indexOf("?");
    const params = new URLSearchParams(
      separator < 0 ? "" : path.slice(separator + 1),
    );
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      params.delete(key);
      for (const entry of Array.isArray(value) ? value : [value])
        params.append(key, String(entry));
    }
    path = `${separator < 0 ? path : path.slice(0, separator)}?${params}`;
  }
  return credentialBroker(ctx, () => googleRuntime(ctx, plugin, scopes)).request(
    {
      target,
      path,
      method: (init.method ?? "GET") as HttpMethod,
      headers: init.headers,
      body: init.body,
    },
  );
}

export async function googleJsonRequest(
  ctx: ActionContext,
  plugin: string,
  scopes: string[],
  method: string,
  url: string,
  body?: unknown,
  query?: Record<string, unknown>,
): Promise<unknown> {
  const response = await googleResponse(
    ctx,
    plugin,
    scopes,
    url,
    {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    query,
  );
  if (!response.ok)
    throw new Error(`${plugin}: request failed (HTTP ${response.status})`);
  if (response.status === 204) return { success: true };
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : { success: true };
  } catch {
    throw new AuthError("invalid_response");
  }
}

export async function googleProbe(
  ctx: ActionContext,
  plugin: string,
  scopes: string[],
) {
  return credentialBroker(ctx, () =>
    googleRuntime(ctx, plugin, scopes),
  ).probe();
}

/** Only Google-issued thumbnail hosts; never attach credentials to signed URLs. */
export async function googleDownload(value: string): Promise<Response> {
  let url: URL;
  try {
    url = new URL(value);
    if (
      url.port ||
      !(
        url.hostname === "googleusercontent.com" ||
        url.hostname.endsWith(".googleusercontent.com")
      )
    )
      throw new Error();
  } catch {
    throw new AuthError("request_not_allowed");
  }
  return downloadResource(value, {
    allowedOrigins: [url.origin],
    fetch: globalThis.fetch,
  });
}
