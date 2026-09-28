import {
  type ActionContext,
  AuthError,
  type CredentialDeclaration,
  type HttpMethod,
} from "runline";
import { credentialBroker } from "./credentialAdapter.js";
import { staticCredential } from "./credentials.js";
import { SHIFT_API_URL, shiftError } from "./shiftCloud.js";

/**
 * The Shift family (shiftAtlas, shiftBwm, shiftCrm, shiftObjects,
 * shiftPages, shiftWork) signs with one Shift API key, as a bearer, beneath
 * the cloud API's /v1 surface. Each plugin may name its own probe: not every
 * key reaches every service.
 */
export function shiftCredential(probe?: string): CredentialDeclaration {
  return staticCredential({
    id: "shift",
    auth: { kind: "bearer" },
    local: { secret: "apiKey" },
    targets: {
      api: {
        baseUrl: `${SHIFT_API_URL}/v1/`,
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
        allowedHeaders: ["Idempotency-Key"],
      },
    },
    ...(probe
      ? {
          probe: {
            target: "api",
            path: probe,
            method: "GET",
            acceptedStatuses: [200],
          },
        }
      : {}),
  });
}

/** An absolute /v1/... route as a path beneath the Shift target. */
export function shiftPath(route: string): string {
  if (!route.startsWith("/v1/")) throw new AuthError("request_not_allowed");
  return route.slice("/v1/".length);
}

/**
 * A Shift plugin's credential and its request function, bound together so
 * a plugin cannot sign with one declaration and declare another.
 */
export function shiftClient(plugin: string, probe?: string) {
  const credential = shiftCredential(probe);
  return {
    credential,
    request: <T>(
      ctx: ActionContext,
      route: string,
      init?: { method?: string; body?: string },
    ) => shiftRequest<T>(ctx, credential, plugin, route, init),
  };
}

/**
 * One Shift API call through the declared credential. A JSON body is sent
 * as JSON; 204 answers no value.
 */
export async function shiftRequest<T>(
  ctx: ActionContext,
  declaration: CredentialDeclaration,
  plugin: string,
  route: string,
  init: { method?: string; body?: string } = {},
): Promise<T> {
  const path = shiftPath(route);
  const response = await credentialBroker(ctx, declaration).request({
    target: "api",
    path,
    method: (init.method ?? "GET") as HttpMethod,
    headers: {
      Accept: "application/json",
      ...(init.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    ...(init.body !== undefined ? { body: init.body } : {}),
  });
  if (!response.ok) throw await shiftError(plugin, response);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AuthError("invalid_response");
  }
}
