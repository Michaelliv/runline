import * as t from "typebox";
import { Check } from "typebox/value";
import { AuthError } from "../auth/errors.js";
import { validateOAuth2ExchangePolicy } from "../auth/oauth2.js";
import { oauthEndpoint, providerParameters } from "../auth/token.js";
import { HTTP_METHODS, headerName, resourceUrl, targetBase } from "./policy.js";
import type { CredentialMethod, CredentialType } from "./types.js";

/** Normalized grant storage; application registration remains host-owned. */
export const OAuthTokensSchema = t.Object(
  {
    accessToken: t.String({ minLength: 1 }),
    refreshToken: t.Optional(t.String({ minLength: 1 })),
    expiresAt: t.Optional(
      t.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    ),
    scope: t.Optional(t.String()),
    tokenType: t.Optional(t.String({ minLength: 1 })),
    metadata: t.Optional(t.Record(t.String(), t.String())),
  },
  { additionalProperties: false },
);

export const OAuthGrantSchema = t.Object(
  {
    tokens: t.Partial(OAuthTokensSchema),
    revision: t.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

function identifier(value: string): void {
  if (typeof value !== "string" || !/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(value))
    throw new AuthError("invalid_definition");
}

function validateMethod(method: CredentialMethod): void {
  const schema = method.schema as {
    type?: string;
    additionalProperties?: boolean;
    properties?: Record<string, unknown>;
  };
  if (
    schema.type !== "object" ||
    schema.additionalProperties !== false ||
    !schema.properties
  )
    throw new AuthError("invalid_definition");
  const auth = method.authentication;
  const field = auth.kind === "oauth2" ? auth.grantField : auth.field;
  identifier(field);
  if (!Object.hasOwn(schema.properties, field))
    throw new AuthError("invalid_definition");
  let injected = "authorization";
  if (auth.kind === "apiKey") injected = headerName(auth.header);
  else if (auth.kind === "oauth2") {
    identifier(auth.definition.id);
    identifier(auth.definition.provider);
    validateOAuth2ExchangePolicy(auth.definition.exchange);
    if (
      !["refresh", "clientCredentials", "jwtBearer"].includes(auth.renewal) ||
      !auth.definition[auth.renewal]
    )
      throw new AuthError("invalid_definition");
    if (
      auth.rejectionStatus !== undefined &&
      ![401, 403].includes(auth.rejectionStatus)
    )
      throw new AuthError("invalid_definition");
    if (
      auth.scopes &&
      (!Array.isArray(auth.scopes) ||
        auth.scopes.some((scope) => typeof scope !== "string" || !scope))
    )
      throw new AuthError("invalid_definition");
    if (
      auth.renewal === "jwtBearer" &&
      (!auth.scopes?.length ||
        auth.definition.jwtBearer?.clientAuthentication !== "none" ||
        auth.definition.jwtBearer?.grantType !== undefined)
    )
      throw new AuthError("invalid_definition");
    if (auth.definition.authorization) {
      oauthEndpoint(auth.definition.authorization.url);
      providerParameters(auth.definition.authorization.parameters);
    }
    for (const operation of [
      "exchange",
      "refresh",
      "clientCredentials",
      "jwtBearer",
    ] as const) {
      const endpoint = auth.definition[operation];
      if (!endpoint) continue;
      oauthEndpoint(endpoint.url);
      providerParameters(endpoint.parameters);
      if (
        ![
          "none",
          "client_id",
          "client_secret_basic",
          "client_secret_post",
        ].includes(endpoint.clientAuthentication) ||
        (endpoint.encoding !== undefined &&
          !["form", "json"].includes(endpoint.encoding))
      )
        throw new AuthError("invalid_definition");
    }
  } else if (auth.kind !== "bearer") throw new AuthError("invalid_definition");
  if (!Object.keys(method.targets).length)
    throw new AuthError("invalid_definition");
  for (const [name, target] of Object.entries(method.targets)) {
    identifier(name);
    targetBase(target);
    if (
      !Array.isArray(target.methods) ||
      !target.methods.length ||
      target.methods.some((m) => !HTTP_METHODS.includes(m))
    )
      throw new AuthError("invalid_definition");
    if (
      target.allowedHeaders !== undefined &&
      !Array.isArray(target.allowedHeaders)
    )
      throw new AuthError("invalid_definition");
    for (const name of target.allowedHeaders ?? []) {
      const header = headerName(name);
      if (header === injected || header === "authorization")
        throw new AuthError("invalid_definition");
    }
    if (
      target.resumableUpload !== undefined &&
      (typeof target.resumableUpload !== "boolean" ||
        !target.methods.includes("PUT") ||
        !target.allowedHeaders?.some(
          (name) => name.toLowerCase() === "content-range",
        ))
    )
      throw new AuthError("invalid_definition");
    if (target.idempotency) {
      const header = headerName(target.idempotency.header);
      if (
        header === injected ||
        header === "authorization" ||
        !target.idempotency.methods.length ||
        target.idempotency.methods.some(
          (m) => !target.methods.includes(m) || m === "GET" || m === "HEAD",
        )
      )
        throw new AuthError("invalid_definition");
    }
  }
  if (method.probe) {
    const probe = method.probe;
    const target = Object.hasOwn(method.targets, probe.target)
      ? method.targets[probe.target]
      : undefined;
    if (
      !target ||
      !["GET", "HEAD"].includes(probe.method) ||
      !target.methods.includes(probe.method) ||
      !probe.acceptedStatuses.length ||
      probe.acceptedStatuses.some(
        (status) => !Number.isInteger(status) || status < 200 || status > 299,
      )
    )
      throw new AuthError("invalid_definition");
    resourceUrl(target, probe.path);
  }
}

/** No implicit defaults, provider inference, executable expressions, or replacement. */
export class CredentialRegistry {
  private readonly types = new Map<string, CredentialType>();

  register(definition: CredentialType): void {
    let copy: CredentialType;
    try {
      copy = structuredClone(definition);
      identifier(copy.id);
      if (this.types.has(copy.id) || !Object.keys(copy.methods).length)
        throw new Error();
      for (const [name, method] of Object.entries(copy.methods)) {
        identifier(name);
        validateMethod(method);
      }
    } catch {
      throw new AuthError("invalid_definition");
    }
    this.types.set(copy.id, copy);
  }

  select(type: string, method: string): CredentialMethod {
    const definition = this.types.get(type);
    if (!definition || !Object.hasOwn(definition.methods, method))
      throw new AuthError("invalid_definition");
    return structuredClone(definition.methods[method]);
  }

  list(): CredentialType[] {
    return structuredClone([...this.types.values()]);
  }
}

/** Validation never formats schema errors containing credential values. */
export function validateCredential(
  method: CredentialMethod,
  config: unknown,
): asserts config is Record<string, unknown> {
  try {
    if (Check(method.schema, config)) return;
  } catch {
    throw new AuthError("invalid_definition");
  }
  throw new AuthError("invalid_credentials");
}
