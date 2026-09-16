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
}

export type CredentialAuthentication =
  | { kind: "apiKey"; field: string; header: string }
  | { kind: "bearer"; field: string }
  | {
      kind: "oauth2";
      /** Top-level config field containing a revisioned OAuthGrant. */
      grantField: string;
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
