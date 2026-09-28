import type { TSchema } from "typebox";
import type {
  OAuth2Definition,
  OAuthApplication,
  OAuthJwtIdentity,
  OAuthResourceOwner,
  OAuthTokens,
} from "../auth/types.js";
import type { ConnectionHandle } from "../connections/types.js";

/** HTTP methods, and the WebDAV methods a file API needs (RFC 4918). */
export type HttpMethod =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "MKCOL"
  | "COPY"
  | "MOVE";

/** Host-approved resource boundary. No wildcards, templates, or agent-selected origins. */
export interface CredentialTarget {
  /** HTTPS URL ending in /. Requests stay beneath this exact origin and path. */
  baseUrl: string;
  methods: HttpMethod[];
  /** Additional caller-set headers beyond Accept and Content-Type. Auth is reserved. */
  allowedHeaders?: string[];
  /**
   * The provider addresses one resource by a slashed name inside one
   * segment, encoded (`group%2Fproject`, `@scope%2Fpkg`). Each piece
   * between the decoded slashes must still be non-empty and not a dot
   * segment.
   */
  encodedSlashes?: boolean;
  /** Google-style PUT upload acknowledgements: allow 308 only without Location. */
  resumableUpload?: boolean;
  /** Declare only when the provider guarantees deduplication for these methods. */
  idempotency?: { header: string; methods: HttpMethod[] };
  /**
   * Deadline for requests to this target when the provider holds them open
   * longer than the transport default (synchronous extraction, long polls).
   * Capped by the host's `maxTargetTimeoutMs`.
   */
  timeoutMs?: number;
  /**
   * Response ceiling for this target when its answers are larger than the
   * transport default (audio, documents). Capped by the host's
   * `maxTargetResponseBytes`.
   */
  maxResponseBytes?: number;
}

/**
 * Where the transport puts a static secret's parts. Every name it sets is
 * reserved: a caller may never supply that header, query parameter or
 * body field.
 */
export type SecretPlacement = (
  | {
      in: "header";
      part: string;
      name: string;
      /** Fixed scheme before the secret, e.g. "Bearer ", "SSWS " or "Bot ". */
      prefix?: string;
    }
  | { in: "query"; part: string; name: string }
  /**
   * A top-level field of a JSON-object or form body; in the query when
   * the request carries no body.
   */
  | { in: "body"; part: string; name: string }
  /**
   * A position deeper in a JSON body, by RFC 6901 pointer (Odoo's
   * `/params/args/2`); the request carries null there for the transport
   * to fill.
   */
  | { in: "jsonPointer"; part: string; pointer: string }
  /**
   * The first path segment beneath the target's base, as `<prefix><part>`:
   * Telegram's `bot<token>`, an account ID before its resources.
   */
  | { in: "path"; part: string; prefix?: string }
  /** HTTP Basic in Authorization, from two parts; either may be empty. */
  | { in: "basic"; username: string; password: string }
  /**
   * An HS256 JWT signed per request from a `<key id>:<hex secret>` part
   * (Ghost's Admin API key) for `audience`, valid five minutes, sent as
   * `<name>: <prefix><token>`.
   */
  | {
      in: "jwt";
      part: string;
      name: string;
      prefix?: string;
      audience: string;
    }
  /**
   * An HMAC-SHA256 of the request's query string as sent, keyed by the
   * part, base64 in header `name` (Unleashed); computed after every other
   * placement, so it signs what goes out.
   */
  | { in: "querySignature"; part: string; name: string }
) & {
  /**
   * The targets this placement signs; every target when absent. Two
   * credentials in one connection, each for its own API, are two parts
   * scoped to their own targets.
   */
  targets?: string[];
};

/**
 * How a request is signed. `field` names the one top-level config field
 * holding the secret: for `static`, a record of the named `parts`
 * (`staticSecretSchema(parts)`), each sent through its placements; for
 * `oauth2`, a revisioned OAuthGrant. `none` signs nothing: the method of a
 * connection that holds no optional credential, still pinned to its
 * targets.
 */
export type CredentialAuthentication =
  | { kind: "none" }
  | {
      kind: "static";
      field: string;
      parts: string[];
      /**
       * Parts a connection may lack; a request to a target that places a
       * missing part is refused as invalid_credentials.
       */
      optionalParts?: string[];
      placements: SecretPlacement[];
    }
  | {
      kind: "oauth2";
      field: string;
      definition: OAuth2Definition;
      /** Explicit renewal strategy, never inferred from available secrets. */
      renewal: "refresh" | "clientCredentials" | "jwtBearer" | "password";
      scopes?: string[];
      /** Defaults to 401. A 403 must be explicitly documented by the provider. */
      rejectionStatus?: 401 | 403;
    };

export interface CredentialProbe {
  target: string;
  /** Fixed relative path, including any fixed query. No expressions or callbacks. */
  path: string;
  method: "GET" | "HEAD";
  /** Only these 2xx responses count as accepted; this does not prove identity. */
  acceptedStatuses: number[];
}

export interface CredentialMethod {
  /** Strict object schema for this method's credential config, not action input. */
  schema: TSchema;
  authentication: CredentialAuthentication;
  targets: Record<string, CredentialTarget>;
  probe?: CredentialProbe;
}

/** Registered by trusted hosts; method names describe provider-specific choices. */
export interface CredentialType {
  id: string;
  methods: Record<string, CredentialMethod>;
}

/**
 * What a connection signs with: the credential type and method, and the
 * OAuth application, JWT identity and resource owner its config supplies.
 * Derived from the connection's config alone — never from action input.
 */
export interface CredentialSelection {
  type: CredentialType;
  method: string;
  application?: OAuthApplication;
  jwtIdentity?: OAuthJwtIdentity;
  resourceOwner?: OAuthResourceOwner;
  /**
   * How a process signing with its own flat connection config (the CLI)
   * assembles a static secret: each of its parts, from a named config
   * field, a fixed value, or the two joined in order
   * (`{email}/token`). Names and fixed values only, never a secret. Hosts
   * that store the structured field ignore it.
   */
  localSecret?: Record<string, LocalSecretSource>;
}

export type LocalSecretPart = { field: string } | { value: string };
export type LocalSecretSource = LocalSecretPart | { concat: LocalSecretPart[] };

/**
 * A plugin's statement of how a connection's config becomes its
 * selection. Pure: no IO, no action input. Whoever holds the config signs
 * from it — the plugin's own process, or a host brokering for it, which
 * reads the declaration from the plugin it loaded itself. Throws
 * `invalid_credentials` for a config it cannot sign with.
 */
export type CredentialDeclaration = (
  config: Readonly<Record<string, unknown>>,
) => CredentialSelection;

/** Host-authorized selection. Never derive this binding from action input. */
export interface CredentialBinding {
  type: string;
  method: string;
  connection: ConnectionHandle;
  /** Expected identity of every read and committed update. */
  identity: { name: string; plugin: string };
  application?: OAuthApplication;
  jwtIdentity?: OAuthJwtIdentity;
  resourceOwner?: OAuthResourceOwner;
}

/** Revision changes on every issuance, even when the provider repeats the token value. */
export interface OAuthGrant {
  /** Setup may seed only a refresh token; issuance always supplies an access token. */
  tokens: Partial<OAuthTokens>;
  revision: string;
}

export type CredentialProbeResult = {
  outcome: "accepted" | "rejected" | "unverified";
  status?: number;
};
