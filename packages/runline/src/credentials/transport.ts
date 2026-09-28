import { createHmac, randomUUID } from "node:crypto";
import { Check } from "typebox/value";
import { AuthError } from "../auth/errors.js";
import {
  acquireOAuth2ClientToken,
  acquireOAuth2JwtToken,
  acquireOAuth2PasswordToken,
  refreshOAuth2Token,
} from "../auth/oauth2.js";
import type { OAuthRuntimeOptions, OAuthTokens } from "../auth/types.js";
import type { ConnectionConfig } from "../plugin/types.js";
import { sendResource } from "./http.js";
import {
  bodyFields,
  bodyFormat,
  bounded,
  headerName,
  injectedFields,
  injectedHeaders,
  injectedParams,
  injectedPointers,
  placementsFor,
  pointerSlot,
  refuseCredentialParams,
  resourceUrl,
  TARGET_RESPONSE_LIMIT_BYTES,
  TARGET_TIMEOUT_LIMIT_MS,
  TRANSPORT_HEADERS,
  targetBase,
} from "./policy.js";
import {
  type CredentialRegistry,
  OAuthGrantSchema,
  validateCredential,
} from "./registry.js";
import type {
  CredentialAuthentication,
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
  /**
   * COPY and MOVE only, and required there: where the resource goes, a
   * path beneath the same target checked as `path` is, sent as the
   * absolute Destination header. Callers never set that header.
   */
  destination?: string;
  /** Enables write replay only with a provider-declared idempotency contract. */
  idempotencyKey?: string;
  /** Disable even otherwise-safe replay for a particular request. */
  retry?: "never";
}

/**
 * Authenticated requests and probes for one connection, on behalf of one
 * action call, signed by whoever holds its credentials. A host that keeps
 * credentials outside the process running actions supplies one per call;
 * the plugin never sees the token it is signed with.
 */
export interface CredentialBroker {
  request(input: AuthenticatedRequest): Promise<Response>;
  probe(): Promise<CredentialProbeResult>;
}

/** The action call a host builds a broker for. `context` is the per-run
 *  context the embedder passed to `execute()`: host authority, never
 *  action input. */
export interface CredentialBrokerCall {
  plugin: string;
  action: string;
  context?: unknown;
}

export interface CredentialTransportOptions {
  /** Mandatory trusted transport: enforce DNS/IP egress policy for token AND API requests. */
  fetch: typeof globalThis.fetch;
  /** Deadline for token requests and for targets that declare none. */
  timeoutMs?: number;
  /** Response ceiling for targets that declare none. */
  maxResponseBytes?: number;
  maxRequestBytes?: number;
  /** The longest deadline a target may declare. */
  maxTargetTimeoutMs?: number;
  /** The largest response ceiling a target may declare. */
  maxTargetResponseBytes?: number;
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
  const grant = config[auth.field];
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
    resourceOwner: structuredClone(selection.resourceOwner),
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
 * RFC 7617 user-pass. A colon in the username, or any byte outside printable
 * ASCII, would make the header ambiguous or encoding-dependent.
 */
function basicCredentials(username: string, password: string): string {
  if (
    (!username && !password) ||
    username.includes(":") ||
    [...username, ...password].some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) > 126,
    )
  )
    throw new AuthError("invalid_credentials");
  return Buffer.from(`${username}:${password}`).toString("base64");
}

/** One outgoing request, as a signer may change it. */
interface Outgoing {
  headers: Headers;
  url: URL;
  body?: Buffer;
  /** The target's base path, beneath which a path part is inserted. */
  base: string;
}

/**
 * A secret as one path segment: `/`, `\`, `?`, `#` and dot segments are
 * refused rather than encoded; `:` and `@`, which RFC 3986 allows in a
 * segment, stay literal (Telegram's `bot<id>:<token>`).
 */
function pathPart(value: string): string {
  if (value === "." || value === ".." || /[/\\?#]/.test(value))
    throw new AuthError("invalid_credentials");
  return encodeURIComponent(value).replace(/%3A/gi, ":").replace(/%40/gi, "@");
}

/** Applies a credential to one outgoing request. */
type Signer = (request: Outgoing) => void;

/**
 * Mints HS256 JWTs from a `<key id>:<hex secret>` key for `audience`,
 * each issued when minted and valid five minutes. Any other key shape is
 * refused here, before any IO.
 */
function hs256Jwt(key: string, audience: string): () => string {
  const match = /^([A-Za-z0-9]+):((?:[0-9a-f]{2})+)$/i.exec(key);
  if (!match) throw new AuthError("invalid_credentials");
  const secret = Buffer.from(match[2], "hex");
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT", kid: match[1] });
  return () => {
    const iat = Math.floor(Date.now() / 1000);
    const unsigned = `${header}.${encode({ iat, exp: iat + 300, aud: audience })}`;
    const signature = createHmac("sha256", secret)
      .update(unsigned)
      .digest("base64url");
    return `${unsigned}.${signature}`;
  };
}

function bearer(token: string): Signer {
  return ({ headers }) => headers.set("authorization", `Bearer ${token}`);
}

/**
 * Adds a field to a JSON-object or form body, whose shape was checked
 * before any IO; with no body, to the query.
 */
function addField(request: Outgoing, name: string, value: string): void {
  if (!request.body) {
    request.url.searchParams.append(name, value);
    return;
  }
  const text = request.body.toString();
  if (bodyFormat(request.headers) === "form") {
    const form = new URLSearchParams(text);
    form.append(name, value);
    request.body = Buffer.from(form.toString());
  } else {
    request.body = Buffer.from(
      JSON.stringify({ ...JSON.parse(text), [name]: value }),
    );
  }
}

/**
 * A static secret's signer for one target, every part it places checked
 * before any IO. `parts` has passed the method's schema, which the
 * registry pins to exactly the declared parts, each a string; an optional
 * part the connection lacks refuses the targets that place it. A query
 * signature runs last, over the query every other placement has written.
 */
function placeStatic(
  auth: Extract<CredentialAuthentication, { kind: "static" }>,
  parts: Record<string, string | undefined>,
  target: string,
): Signer {
  const part = (name: string) => {
    const value = parts[name];
    if (value === undefined) throw new AuthError("invalid_credentials");
    return value;
  };
  const ordered = placementsFor(auth, target).sort(
    (a, b) =>
      Number(a.in === "querySignature") - Number(b.in === "querySignature"),
  );
  const steps = ordered.map((placement): Signer => {
    if (placement.in === "basic") {
      const value = basicCredentials(
        part(placement.username),
        part(placement.password),
      );
      return ({ headers }) => headers.set("authorization", `Basic ${value}`);
    }
    const value = secret(part(placement.part));
    if (placement.in === "query")
      return ({ url }) => url.searchParams.append(placement.name, value);
    if (placement.in === "body")
      return (request) => addField(request, placement.name, value);
    if (placement.in === "jsonPointer")
      return (request) => {
        const json: unknown = JSON.parse(String(request.body));
        const slot = pointerSlot(json, placement.pointer);
        if (!slot) throw new AuthError("request_not_allowed");
        slot.holder[slot.key] = value;
        request.body = Buffer.from(JSON.stringify(json));
      };
    if (placement.in === "path") {
      const segment = `${placement.prefix ?? ""}${pathPart(value)}`;
      return ({ url, base }) => {
        const rest = url.pathname.slice(base.length);
        url.pathname = `${base}${segment}${rest ? `/${rest}` : ""}`;
      };
    }
    const name = headerName(placement.name);
    if (placement.in === "jwt") {
      const mint = hs256Jwt(value, placement.audience);
      return ({ headers }) =>
        headers.set(name, `${placement.prefix ?? ""}${mint()}`);
    }
    if (placement.in === "querySignature")
      return ({ url, headers }) =>
        headers.set(
          name,
          createHmac("sha256", value)
            .update(url.search.slice(1))
            .digest("base64"),
        );
    return ({ headers }) =>
      headers.set(name, `${placement.prefix ?? ""}${value}`);
  });
  return (request) => {
    for (const step of steps) step(request);
  };
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
      maxTargetTimeoutMs: options.maxTargetTimeoutMs ?? 10 * 60_000,
      maxTargetResponseBytes:
        options.maxTargetResponseBytes ?? 256 * 1024 * 1024,
    };
    if (
      typeof this.options.fetch !== "function" ||
      !bounded(this.options.timeoutMs, 120_000) ||
      !bounded(this.options.maxResponseBytes, 64 * 1024 * 1024) ||
      !bounded(this.options.maxRequestBytes, 64 * 1024 * 1024) ||
      !bounded(this.options.maxTargetTimeoutMs, TARGET_TIMEOUT_LIMIT_MS) ||
      !bounded(this.options.maxTargetResponseBytes, TARGET_RESPONSE_LIMIT_BYTES)
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
          const tokens = await this.issue(auth, binding, previous);
          const patch = {
            [auth.field]: { tokens, revision: randomUUID() },
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

  /** New tokens by the method's declared renewal, from what the binding supplies. */
  private issue(
    auth: Extract<CredentialAuthentication, { kind: "oauth2" }>,
    binding: CredentialBinding,
    previous: OAuthGrant | undefined,
  ): Promise<OAuthTokens> {
    const options: OAuthRuntimeOptions = {
      fetch: this.options.fetch,
      timeoutMs: this.options.timeoutMs,
    };
    const { definition, scopes } = auth;
    const { application, jwtIdentity, resourceOwner } = binding;
    if (auth.renewal === "refresh")
      return refreshOAuth2Token(
        definition,
        { application, tokens: previous?.tokens ?? {}, scopes },
        options,
      );
    if (auth.renewal === "jwtBearer") {
      if (!jwtIdentity) throw new AuthError("invalid_credentials");
      return acquireOAuth2JwtToken(
        definition,
        { identity: jwtIdentity, scopes: scopes ?? [] },
        options,
      );
    }
    if (auth.renewal === "password") {
      if (!resourceOwner) throw new AuthError("invalid_credentials");
      return acquireOAuth2PasswordToken(
        definition,
        { owner: resourceOwner, application, scopes },
        options,
      );
    }
    return acquireOAuth2ClientToken(
      definition,
      { application: application ?? { clientId: "" }, scopes },
      options,
    );
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
    const auth = method.authentication;
    refuseCredentialParams(url, injectedParams(auth, input.target));
    const reserved = injectedHeaders(auth, input.target);
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
          reserved.includes(normalized) ||
          TRANSPORT_HEADERS.includes(normalized) ||
          normalized === target.idempotency?.header.toLowerCase() ||
          typeof value !== "string"
        )
          throw new Error();
        headers.set(normalized, value);
      }
      const copies = verb === "COPY" || verb === "MOVE";
      if (copies !== (input.destination !== undefined)) throw new Error();
      if (input.destination !== undefined) {
        if (
          typeof input.destination !== "string" ||
          !input.destination ||
          input.destination.includes("?")
        )
          throw new Error();
        headers.set(
          "destination",
          resourceUrl(target, input.destination).toString(),
        );
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
        const fields = injectedFields(auth, input.target).map((name) =>
          name.toLowerCase(),
        );
        if (
          fields.length &&
          bodyFields(headers, body).some((name) =>
            fields.includes(name.toLowerCase()),
          )
        )
          throw new Error();
      }
      const pointers = injectedPointers(auth, input.target);
      if (pointers.length) {
        if (!body || bodyFormat(headers) !== "json") throw new Error();
        const json: unknown = JSON.parse(body.toString());
        for (const pointer of pointers) {
          const slot = pointerSlot(json, pointer);
          if (!slot || slot.holder[slot.key] !== null) throw new Error();
        }
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
    const base = targetBase(target).pathname;
    let { sign, grant } = await this.authorize(binding, method, input.target);
    const send = async (signer: Signer) => {
      const outgoing: Outgoing = {
        headers: new Headers(headers),
        url: new URL(url),
        body,
        base,
      };
      signer(outgoing);
      return sendResource(
        outgoing.url.toString(),
        verb,
        outgoing.headers,
        outgoing.body,
        {
          fetch: this.options.fetch,
          timeoutMs: Math.min(
            target.timeoutMs ?? this.options.timeoutMs,
            this.options.maxTargetTimeoutMs,
          ),
          maxResponseBytes: Math.min(
            target.maxResponseBytes ?? this.options.maxResponseBytes,
            this.options.maxTargetResponseBytes,
          ),
          resumableUpload: target.resumableUpload,
        },
      );
    };
    const first = await send(sign);
    if (
      auth.kind !== "oauth2" ||
      !grant ||
      !replay ||
      first.status !== (auth.rejectionStatus ?? 401)
    )
      return first;
    // Exactly one replay, only after durable renewal (or a newer committed revision).
    grant = await this.renew(binding, method, grant.revision, true);
    return send(bearer(secret(grant.tokens.accessToken)));
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

  private async authorize(
    binding: CredentialBinding,
    method: CredentialMethod,
    target: string,
  ): Promise<{ sign: Signer; grant?: OAuthGrant }> {
    const config = await this.read(binding, method);
    const auth = method.authentication;
    if (auth.kind === "none") return { sign: () => {} };
    if (auth.kind === "static")
      return {
        sign: placeStatic(
          auth,
          config[auth.field] as Record<string, string | undefined>,
          target,
        ),
      };
    let grant = grantFrom(method, config);
    if (!fresh(grant))
      grant = await this.renew(binding, method, grant?.revision);
    return { sign: bearer(secret(grant?.tokens.accessToken)), grant };
  }
}
