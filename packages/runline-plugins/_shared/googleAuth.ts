import {
  type ActionContext,
  AuthError,
  downloadResource,
  type HttpMethod,
  type OAuthConfig,
} from "runline";
import { credentialBroker } from "./credentialAdapter.js";
import { jsonAnswer, requestFailed } from "./credentials.js";
import {
  GOOGLE_GRANT,
  GOOGLE_TOKEN_URL,
  googleCredential,
  googleResources,
  googleServices,
} from "./googleCredentials.js";

export type { GoogleAuthConfig } from "./googleCredentials.js";
export { googleCredential } from "./googleCredentials.js";

/**
 * A Google plugin's OAuth declaration: Google's endpoints, the offline
 * consent that returns a refresh token (without `access_type=offline` and
 * `prompt=consent` a repeat login omits it), the grant every Google plugin
 * shares, and setup steps that enable the APIs its targets call and name
 * its client variables (`env`: `GMAIL` → `GMAIL_CLIENT_ID`).
 */
export function googleOAuth(
  plugin: string,
  scopes: string[],
  env: string,
): OAuthConfig {
  return {
    grant: GOOGLE_GRANT,
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: GOOGLE_TOKEN_URL,
    scopes,
    authParams: { access_type: "offline", prompt: "consent" },
    setupHelp: [
      "You need a Google Cloud OAuth client. Takes ~5 minutes, one time;",
      "the same client serves every Google plugin.",
      "Do the steps in order — skipping step 4 causes a 403 when you log in.",
      "",
      "1. Create a Google Cloud project (or pick an existing one):",
      "     https://console.cloud.google.com/projectcreate",
      "   Make sure the project is selected in the top navigation dropdown.",
      "",
      "2. Enable the APIs this plugin calls (click 'Enable' on each):",
      ...googleServices(plugin).map(
        (service) =>
          `     https://console.cloud.google.com/apis/library/${service}`,
      ),
      "",
      "3. Configure the OAuth consent screen (first time only):",
      "     https://console.cloud.google.com/apis/credentials/consent",
      "   Click 'Get started' and fill in:",
      "     • App name: runline (or whatever)",
      "     • User support email: your email",
      "     • Audience: External",
      "     • Developer contact: your email",
      "   You can skip the Scopes screen — runline declares scopes at auth time.",
      "",
      "4. Add yourself as a test user (required — External apps in Testing mode",
      "   only allow authentication from addresses on this list):",
      "     https://console.cloud.google.com/auth/audience",
      "   Under 'Test users', click '+ Add users' and enter the Google address",
      "   you'll use to log in. Consent and refresh tokens expire every 7 days",
      "   while the app is in Testing mode.",
      "",
      "5. Create the OAuth client:",
      "     https://console.cloud.google.com/apis/credentials",
      "     • + Create credentials → OAuth client ID",
      "     • Application type: Web application",
      "     • Name: runline (or whatever)",
      "     • Authorized redirect URIs → + Add URI:",
      "         {{redirectUri}}",
      "     • Click Create, then copy the Client ID and Client Secret from the",
      "       dialog — the secret is only shown once.",
      "",
      "6. Paste them below (or re-run with --client-id / --client-secret,",
      `   or export ${env}_CLIENT_ID and ${env}_CLIENT_SECRET).`,
      "",
      "During login you'll see a 'Google hasn't verified this app' warning.",
      "Click 'Advanced → Go to runline (unsafe)' to continue — this is",
      "expected for apps in Testing mode.",
    ],
  };
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
  return credentialBroker(ctx, googleCredential(plugin, scopes)).request({
    target,
    path,
    method: (init.method ?? "GET") as HttpMethod,
    headers: init.headers,
    body: init.body,
  });
}

/** A Google JSON request that must succeed; its answer is read by `jsonAnswer`. */
export async function googleJsonRequest<T = unknown>(
  ctx: ActionContext,
  plugin: string,
  scopes: string[],
  method: string,
  url: string,
  body?: unknown,
  query?: Record<string, unknown>,
): Promise<T> {
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
  if (!response.ok) throw requestFailed(plugin, response.status);
  return jsonAnswer<T>(response);
}

export async function googleProbe(
  ctx: ActionContext,
  plugin: string,
  scopes: string[],
) {
  return credentialBroker(ctx, googleCredential(plugin, scopes)).probe();
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
