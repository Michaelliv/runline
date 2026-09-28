import {
  type ActionContext,
  AuthError,
  type CredentialDeclaration,
  type HttpMethod,
} from "runline";
import { credentialRequest, staticCredential } from "./credentials.js";
import { SHIFT_API_URL, shiftError } from "./shiftCloud.js";

export interface ShiftCredentialOptions {
  /** Fixed GET beneath /v1/ proving the key reaches the plugin's service. */
  probe?: string;
  /**
   * Deadline for the Shift target, for services that hold a request open
   * longer than the transport default (synchronous extraction, /await
   * long polls). Capped by the host.
   */
  timeoutMs?: number;
  /** Response ceiling for the Shift target, when its answers are larger. */
  maxResponseBytes?: number;
}

/**
 * The Shift family (shiftAtlas, shiftBwm, shiftCrm, shiftObjects,
 * shiftPages, shiftWork) signs with one Shift API key, as a bearer, beneath
 * the cloud API's /v1 surface. Each plugin may name its own probe: not every
 * key reaches every service. Plugins whose service holds requests open
 * (shiftOcr, shiftTranscription) declare the target's own deadline.
 */
export function shiftCredential(
  options: ShiftCredentialOptions = {},
): CredentialDeclaration {
  const { probe, timeoutMs, maxResponseBytes } = options;
  return staticCredential({
    id: "shift",
    auth: { kind: "bearer" },
    local: { secret: "apiKey" },
    targets: {
      api: {
        baseUrl: `${SHIFT_API_URL}/v1/`,
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
        allowedHeaders: ["Idempotency-Key"],
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(maxResponseBytes !== undefined ? { maxResponseBytes } : {}),
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
export function shiftClient(plugin: string, options?: ShiftCredentialOptions) {
  const credential = shiftCredential(options);
  return {
    credential,
    request: <T = unknown>(
      ctx: ActionContext,
      route: string,
      init?: { method?: string; body?: string },
    ) => shiftRequest<T>(ctx, credential, plugin, route, init),
  };
}

/**
 * One Shift API call through the declared credential. A body is JSON text;
 * an empty answer, as the Shift API contract has it, is no value. `T` is the
 * caller's statement of the answer's shape, unchecked.
 */
export async function shiftRequest<T = unknown>(
  ctx: ActionContext,
  declaration: CredentialDeclaration,
  plugin: string,
  route: string,
  init: { method?: string; body?: string } = {},
): Promise<T> {
  const response = await credentialRequest(ctx, declaration, {
    target: "api",
    path: shiftPath(route),
    method: (init.method ?? "GET") as HttpMethod,
    ...(init.body !== undefined
      ? { body: init.body, headers: { "Content-Type": "application/json" } }
      : {}),
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
