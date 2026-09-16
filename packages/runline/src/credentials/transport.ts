import { randomUUID } from "node:crypto";
import { Check } from "typebox/value";
import { AuthError } from "../auth/errors.js";
import {
  acquireOAuth2ClientToken,
  acquireOAuth2JwtToken,
  refreshOAuth2Token,
} from "../auth/oauth2.js";
import type { OAuthRuntimeOptions } from "../auth/types.js";
import type { ConnectionConfig } from "../plugin/types.js";
import { sendResource } from "./http.js";
import { headerName, resourceUrl } from "./policy.js";
import {
  type CredentialRegistry,
  OAuthGrantSchema,
  validateCredential,
} from "./registry.js";
import type {
  CredentialBinding,
  CredentialMethod,
  CredentialProbeResult,
  HttpMethod,
  OAuthGrant,
} from "./types.js";

export interface AuthenticatedRequest {
  target: string;
  path: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  /** Buffered, copied before the first await. Streams and FormData are not accepted. */
  body?: string | Uint8Array;
  /** Enables write replay only with a provider-declared idempotency contract. */
  idempotencyKey?: string;
  /** Disable even otherwise-safe replay for a particular request. */
  retry?: "never";
}

export interface CredentialTransportOptions {
  /** Mandatory trusted transport: enforce DNS/IP egress policy for token AND API requests. */
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRequestBytes?: number;
}

function boundSnapshot(
  binding: CredentialBinding,
  method: CredentialMethod,
  snapshot: ConnectionConfig,
): Record<string, unknown> {
  if (
    snapshot.name !== binding.identity.name ||
    snapshot.plugin !== binding.identity.plugin
  )
    throw new AuthError("binding_changed");
  validateCredential(method, snapshot.config);
  return structuredClone(snapshot.config);
}

function grantFrom(
  method: CredentialMethod,
  config: Readonly<Record<string, unknown>>,
): OAuthGrant | undefined {
  const auth = method.authentication;
  if (auth.kind !== "oauth2") throw new AuthError("invalid_definition");
  const grant = config[auth.grantField];
  if (grant === undefined) return undefined;
  if (!Check(OAuthGrantSchema, grant))
    throw new AuthError("invalid_credentials");
  const result = grant as OAuthGrant;
  if (
    result.tokens.tokenType !== undefined &&
    result.tokens.tokenType.toLowerCase() !== "bearer"
  )
    throw new AuthError("unsupported_operation");
  return result;
}

function pinBinding(selection: CredentialBinding): CredentialBinding {
  return {
    ...selection,
    identity: { ...selection.identity },
    application: structuredClone(selection.application),
    jwtIdentity: structuredClone(selection.jwtIdentity),
    connection: {
      read: selection.connection.read.bind(selection.connection),
      update: selection.connection.update.bind(selection.connection),
    },
  };
}

function fresh(grant: OAuthGrant | undefined): boolean {
  return (
    !!grant?.tokens.accessToken &&
    (grant.tokens.expiresAt === undefined ||
      grant.tokens.expiresAt > Date.now() + 60_000)
  );
}

function secret(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    [...value].some(
      (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) > 126,
    )
  )
    throw new AuthError("invalid_credentials");
  return value;
}

/**
 * Trusted-host primitive, not a workspace sandbox. Callers authorize a binding on
 * every invocation. Handles own lifecycle fencing; no second lock or token cache.
 */
export class CredentialTransport {
  private readonly options: Required<CredentialTransportOptions>;

  constructor(
    private readonly registry: CredentialRegistry,
    options: CredentialTransportOptions,
  ) {
    this.options = {
      fetch: options.fetch,
      timeoutMs: options.timeoutMs ?? 20_000,
      maxResponseBytes: options.maxResponseBytes ?? 8 * 1024 * 1024,
      maxRequestBytes: options.maxRequestBytes ?? 1024 * 1024,
    };
    if (
      typeof this.options.fetch !== "function" ||
      !Number.isInteger(this.options.timeoutMs) ||
      this.options.timeoutMs <= 0 ||
      this.options.timeoutMs > 120_000 ||
      !Number.isSafeInteger(this.options.maxResponseBytes) ||
      this.options.maxResponseBytes <= 0 ||
      this.options.maxResponseBytes > 64 * 1024 * 1024 ||
      !Number.isSafeInteger(this.options.maxRequestBytes) ||
      this.options.maxRequestBytes <= 0 ||
      this.options.maxRequestBytes > 64 * 1024 * 1024
    )
      throw new AuthError("invalid_definition");
  }

  private async read(
    binding: CredentialBinding,
    method: CredentialMethod,
  ): Promise<Record<string, unknown>> {
    let snapshot: ConnectionConfig;
    try {
      snapshot = await binding.connection.read();
    } catch {
      throw new AuthError("credential_store_failed");
    }
    return boundSnapshot(binding, method, snapshot);
  }

  private async renew(
    binding: CredentialBinding,
    method: CredentialMethod,
    observedRevision?: string,
    rejected = false,
  ): Promise<OAuthGrant> {
    const auth = method.authentication;
    if (auth.kind !== "oauth2") throw new AuthError("invalid_definition");
    let callbackError: unknown;
    let committed: ConnectionConfig;
    try {
      committed = await binding.connection.update(async (current) => {
        try {
          validateCredential(method, current);
          const previous = grantFrom(method, current);
          if (
            (fresh(previous) && !rejected) ||
            (previous &&
              previous.revision !== observedRevision &&
              previous.tokens.accessToken &&
              (previous.tokens.expiresAt === undefined ||
                previous.tokens.expiresAt > Date.now()))
          )
            return;
          const options: OAuthRuntimeOptions = {
            fetch: this.options.fetch,
            timeoutMs: this.options.timeoutMs,
          };
          const jwtIdentity = binding.jwtIdentity;
          if (auth.renewal === "jwtBearer" && !jwtIdentity)
            throw new AuthError("invalid_credentials");
          const tokens =
            auth.renewal === "refresh"
              ? await refreshOAuth2Token(
                  auth.definition,
                  {
                    application: binding.application,
                    tokens: previous?.tokens ?? {},
                    scopes: auth.scopes,
                  },
                  options,
                )
              : auth.renewal === "jwtBearer" && jwtIdentity
                ? await acquireOAuth2JwtToken(
                    auth.definition,
                    {
                      identity: jwtIdentity,
                      scopes: auth.scopes ?? [],
                    },
                    options,
                  )
                : await acquireOAuth2ClientToken(
                    auth.definition,
                    {
                      application: binding.application ?? { clientId: "" },
                      scopes: auth.scopes,
                    },
                    options,
                  );
          const patch = {
            [auth.grantField]: { tokens, revision: randomUUID() },
          };
          const next = { ...current, ...patch };
          validateCredential(method, next);
          grantFrom(method, next);
          secret(tokens.accessToken);
          return patch;
        } catch (error) {
          callbackError = error;
          throw error;
        }
      });
    } catch (error) {
      if (error === callbackError && error instanceof AuthError) throw error;
      throw new AuthError("credential_store_failed");
    }
    const grant = grantFrom(method, boundSnapshot(binding, method, committed));
    if (!grant) throw new AuthError("invalid_credentials");
    return grant;
  }

  async request(
    selection: CredentialBinding,
    input: AuthenticatedRequest,
  ): Promise<Response> {
    // Pin authority, routing, headers, registration, and replayable bytes before IO.
    const binding = pinBinding(selection);
    const method = this.registry.select(binding.type, binding.method);
    const target = Object.hasOwn(method.targets, input.target)
      ? method.targets[input.target]
      : undefined;
    if (!target) throw new AuthError("request_not_allowed");
    const url = resourceUrl(target, input.path);
    const verb = input.method ?? "GET";
    if (
      !target.methods.includes(verb) ||
      (input.retry !== undefined && input.retry !== "never")
    )
      throw new AuthError("request_not_allowed");
    for (const name of url.searchParams.keys()) {
      if (
        [
          "access_token",
          "refresh_token",
          "client_secret",
          "api_key",
          "authorization",
        ].includes(name.toLowerCase())
      )
        throw new AuthError("request_not_allowed");
    }
    const auth = method.authentication;
    const authHeader =
      auth.kind === "apiKey" ? headerName(auth.header) : "authorization";
    let headers: Headers;
    let body: Buffer | undefined;
    try {
      headers = new Headers();
      const allowed = new Set([
        "accept",
        "content-type",
        ...(target.allowedHeaders ?? []).map((name) => name.toLowerCase()),
      ]);
      for (const [name, value] of Object.entries(input.headers ?? {})) {
        const normalized = headerName(name);
        if (
          !allowed.has(normalized) ||
          normalized === authHeader ||
          normalized === "authorization" ||
          normalized === target.idempotency?.header.toLowerCase() ||
          typeof value !== "string"
        )
          throw new Error();
        headers.set(normalized, value);
      }
      if (input.body !== undefined) {
        if (
          verb === "GET" ||
          verb === "HEAD" ||
          (typeof input.body !== "string" &&
            !(input.body instanceof Uint8Array))
        )
          throw new Error();
        const size =
          typeof input.body === "string"
            ? Buffer.byteLength(input.body)
            : input.body.byteLength;
        if (size > this.options.maxRequestBytes) throw new Error();
        body = Buffer.from(input.body);
      }
      if (input.idempotencyKey !== undefined) {
        if (!target.idempotency?.methods.includes(verb)) throw new Error();
        headers.set(target.idempotency.header, secret(input.idempotencyKey));
      }
    } catch {
      throw new AuthError("request_not_allowed");
    }
    const replay =
      input.retry !== "never" &&
      (verb === "GET" || verb === "HEAD" || input.idempotencyKey !== undefined);
    let { token, grant } = await this.authorize(binding, method);
    const send = async (value: string) => {
      const signed = new Headers(headers);
      signed.set(
        authHeader,
        auth.kind === "apiKey" ? value : `Bearer ${value}`,
      );
      return sendResource(url.toString(), verb, signed, body, {
        ...this.options,
        resumableUpload: target.resumableUpload,
      });
    };
    const first = await send(token);
    if (
      auth.kind !== "oauth2" ||
      !grant ||
      !replay ||
      first.status !== (auth.rejectionStatus ?? 401)
    )
      return first;
    // Exactly one replay, only after durable renewal (or a newer committed revision).
    grant = await this.renew(binding, method, grant.revision, true);
    return send(secret(grant.tokens.accessToken));
  }

  /** Only a declared read-only probe runs. Results never contain provider text or secrets. */
  async probe(binding: CredentialBinding): Promise<CredentialProbeResult> {
    const probe = this.registry.select(binding.type, binding.method).probe;
    if (!probe) return { outcome: "unverified" };
    try {
      const response = await this.request(binding, probe);
      return {
        outcome: probe.acceptedStatuses.includes(response.status)
          ? "accepted"
          : [401, 403].includes(response.status)
            ? "rejected"
            : "unverified",
        status: response.status,
      };
    } catch (error) {
      return {
        outcome:
          error instanceof AuthError && error.code === "reconnect_required"
            ? "rejected"
            : "unverified",
      };
    }
  }

  /** Trusted-host compatibility primitive. Never expose raw tokens through a broker. */
  async accessToken(selection: CredentialBinding): Promise<string> {
    const binding = pinBinding(selection);
    return (
      await this.authorize(
        binding,
        this.registry.select(binding.type, binding.method),
      )
    ).token;
  }

  private async authorize(
    binding: CredentialBinding,
    method: CredentialMethod,
  ): Promise<{ token: string; grant?: OAuthGrant }> {
    const config = await this.read(binding, method);
    const auth = method.authentication;
    if (auth.kind !== "oauth2") return { token: secret(config[auth.field]) };
    let grant = grantFrom(method, config);
    if (!fresh(grant))
      grant = await this.renew(binding, method, grant?.revision);
    return { token: secret(grant?.tokens.accessToken), grant };
  }
}
