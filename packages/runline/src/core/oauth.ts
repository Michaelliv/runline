/**
 * Generic OAuth2 authorization-code flow.
 *
 * Runs the browser login dance for any plugin that declares
 * `setOAuth(config)`: opens the provider's consent URL, catches
 * the redirect on a local port, exchanges the code for tokens,
 * and returns `{accessToken, refreshToken, expiresAt, scope}`.
 *
 * Provider-agnostic — the caller (the `auth` CLI command) supplies
 * the plugin's `OAuthConfig` along with the client credentials.
 */

import { spawn } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { OAuthConfig } from "../plugin/types.js";

/**
 * Fixed callback port for OAuth redirects. Pinned so users can
 * register `http://127.0.0.1:<PORT>/callback` once with the
 * provider and have it keep working across every `runline auth`
 * invocation. Override via `RUNLINE_OAUTH_CALLBACK_PORT` if you
 * need a different port (you'll have to re-register the redirect
 * URI with the provider after changing it).
 */
export const OAUTH_CALLBACK_PORT: number = (() => {
  const raw = process.env.RUNLINE_OAUTH_CALLBACK_PORT;
  if (raw) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0 && n < 65536) return n;
  }
  return 47823;
})();

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since epoch. */
  expiresAt: number;
  scope?: string;
  tokenType?: string;
}

export interface RunOAuthOptions {
  clientId: string;
  clientSecret: string;
  /**
   * Called with the consent URL before the browser is opened.
   * Lets the CLI print a clickable link in case auto-open fails.
   */
  onAuthUrl?: (url: string) => void;
  /** Override the browser launcher. Defaults to OS-appropriate command. */
  openBrowser?: (url: string) => void;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

/**
 * Run the full OAuth2 authorization-code flow end-to-end.
 * Resolves with the exchanged tokens once the user completes the
 * browser consent and the token endpoint returns a refresh token.
 */
export async function runOAuth(
  config: OAuthConfig,
  options: RunOAuthOptions,
): Promise<OAuthTokens> {
  const port = OAUTH_CALLBACK_PORT;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const state = randomState();

  const authUrl = new URL(config.authUrl);
  authUrl.searchParams.set("client_id", options.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", config.scopes.join(" "));
  authUrl.searchParams.set("state", state);
  for (const [k, v] of Object.entries(config.authParams ?? {})) {
    authUrl.searchParams.set(k, v);
  }

  options.onAuthUrl?.(authUrl.toString());
  const open = options.openBrowser ?? defaultOpenBrowser;
  open(authUrl.toString());

  const { code } = await captureCode(port, state);
  const tokens = await exchangeCode(
    config.tokenUrl,
    code,
    options.clientId,
    options.clientSecret,
    redirectUri,
  );

  if (!tokens.refresh_token) {
    throw new Error(
      "OAuth: provider did not return a refresh token. This usually means a prior consent is cached — revoke access with the provider and retry. For Google, set authParams: { access_type: 'offline', prompt: 'consent' }.",
    );
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope,
    tokenType: tokens.token_type,
  };
}

function captureCode(
  port: number,
  expectedState: string,
): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (url.pathname !== "/callback") {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      if (error) {
        res.statusCode = 400;
        res.end(`Authorization failed: ${error}. You can close this tab.`);
        server.close();
        reject(new Error(`OAuth: ${error}`));
        return;
      }
      if (!code) {
        res.statusCode = 400;
        res.end("Missing code");
        return;
      }
      if (state !== expectedState) {
        res.statusCode = 400;
        res.end("State mismatch — possible CSRF. Aborting.");
        server.close();
        reject(new Error("OAuth: state mismatch"));
        return;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        `<!doctype html><meta charset="utf-8"><title>Connected</title>` +
          `<body style="font-family:system-ui;padding:2rem">` +
          `<h1 style="margin:0 0 0.5rem">Connected \u2713</h1>` +
          `<p style="color:#666">You can close this tab and return to your terminal.</p>`,
      );
      server.close();
      resolve({ code });
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1");
  });
}

async function exchangeCode(
  tokenUrl: string,
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(
      `OAuth: token exchange failed (${res.status}): ${await res.text()}`,
    );
  }
  return (await res.json()) as TokenResponse;
}

function randomState(): string {
  return (
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  );
}

function defaultOpenBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  const proc = spawn(cmd, [url], {
    stdio: "ignore",
    detached: true,
  });
  proc.on("error", () => {
    // Browser failed to open — caller's onAuthUrl prints the URL
    // so the user can paste it manually.
  });
  proc.unref();
}
