import type { TSchema } from "typebox";
import type {
  OAuth2Definition,
  OAuthApplication,
  OAuthJwtIdentity,
  OAuthTokens,
} from "../auth/types.js";
import type { ConnectionHandle } from "../connections/types.js";

export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Host-approved resource boundary. No wildcards, templates, or agent-selected origins. */
export interface CredentialTarget {
  /** HTTPS URL ending in /. Requests stay beneath this exact origin and path. */
  baseUrl: string;
  methods: HttpMethod[];
  /** Additional caller-set headers beyond Accept and Content-Type. Auth is reserved. */
  allowedHeaders?: string[];
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
 * reserved: a caller may never supply that header or query parameter.
 */
export type SecretPlacement =
  | {
      in: "header";
      part: string;
      name: string;
      /** Fixed scheme before the secret, e.g. "Bearer ", "SSWS " or "Bot ". */
      prefix?: string;
    }
  | { in: "query"; part: string; name: string }
  /** HTTP Basic in Authorization, from two parts; either may be empty. */
  | { in: "basic"; username: string; password: string };

/**
 * How a request is signed. `field` names the one top-level config field
 * holding the secret: for `static`, a record of the named `parts`
 * (`staticSecretSchema(parts)`), each sent through its placements; for
 * `oauth2`, a revisioned OAuthGrant.
 */
export type CredentialAuthentication =
  | {
      kind: "static";
      field: string;
      parts: string[];
      placements: SecretPlacement[];
    }
  | {
      kind: "oauth2";
      field: string;
      definition: OAuth2Definition;
      /** Explicit renewal strategy, never inferred from available secrets. */
      renewal: "refresh" | "clientCredentials" | "jwtBearer";
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
 * OAuth application and JWT identity its config supplies. Derived from
 * the connection's config alone — never from action input.
 */
export interface CredentialSelection {
  type: CredentialType;
  method: string;
  application?: OAuthApplication;
  jwtIdentity?: OAuthJwtIdentity;
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
