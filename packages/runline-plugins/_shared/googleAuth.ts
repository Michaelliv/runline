import { createSign } from "node:crypto";
import type { ActionContext } from "runline";
import { coordinatedAccessToken, requestToken } from "./tokenRefresh.js";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export type GoogleAuthConfig = {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  serviceAccountJson?: string;
  serviceAccountEmail?: string;
  serviceAccountPrivateKey?: string;
  serviceAccountSubject?: string;
  accessToken?: string;
  accessTokenExpiresAt?: number;
};

export async function googleAccessToken(
  ctx: ActionContext,
  pluginName: string,
  scopes: string[],
): Promise<string> {
  return coordinatedAccessToken(ctx, async (current) => {
    const cfg = current as GoogleAuthConfig;
    return hasServiceAccountConfig(cfg)
      ? refreshServiceAccountAccessToken(pluginName, cfg, scopes)
      : refreshOAuthAccessToken(pluginName, cfg);
  });
}

function hasServiceAccountConfig(cfg: GoogleAuthConfig): boolean {
  return (
    !!cfg.serviceAccountJson ||
    !!(cfg.serviceAccountEmail && cfg.serviceAccountPrivateKey)
  );
}

async function refreshOAuthAccessToken(
  pluginName: string,
  cfg: GoogleAuthConfig,
) {
  const { clientId, clientSecret, refreshToken } = cfg;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      `${pluginName}: missing OAuth clientId/clientSecret/refreshToken or service account credentials. Run the OAuth helper or set serviceAccountJson.`,
    );
  }

  return requestToken(
    { url: TOKEN_ENDPOINT, clientAuthentication: "client_secret_post" },
    { refresh_token: refreshToken, grant_type: "refresh_token" },
    { clientId, clientSecret },
  );
}

async function refreshServiceAccountAccessToken(
  pluginName: string,
  cfg: GoogleAuthConfig,
  scopes: string[],
) {
  const serviceAccount = parseServiceAccount(pluginName, cfg);
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    {
      alg: "RS256",
      typ: "JWT",
    },
    {
      iss: serviceAccount.client_email,
      scope: scopes.join(" "),
      aud: TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600,
      ...(cfg.serviceAccountSubject ? { sub: cfg.serviceAccountSubject } : {}),
    },
    serviceAccount.private_key,
  );

  return requestToken(
    { url: TOKEN_ENDPOINT, clientAuthentication: "none" },
    { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion },
  );
}

function parseServiceAccount(
  pluginName: string,
  cfg: GoogleAuthConfig,
): { client_email: string; private_key: string } {
  if (cfg.serviceAccountJson) {
    try {
      const parsed = JSON.parse(cfg.serviceAccountJson) as {
        client_email?: string;
        private_key?: string;
      };
      if (parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email,
          private_key: parsed.private_key,
        };
      }
    } catch {
      throw new Error(`${pluginName}: invalid serviceAccountJson`);
    }
  }

  if (cfg.serviceAccountEmail && cfg.serviceAccountPrivateKey) {
    return {
      client_email: cfg.serviceAccountEmail,
      private_key: cfg.serviceAccountPrivateKey.replace(/\\n/g, "\n"),
    };
  }

  throw new Error(
    `${pluginName}: service account requires serviceAccountJson or serviceAccountEmail/serviceAccountPrivateKey`,
  );
}

function signJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKey: string,
): string {
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey.replace(/\\n/g, "\n"));
  return `${signingInput}.${base64url(signature)}`;
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
