import * as t from "typebox";
import { Check } from "typebox/value";
import { AuthError } from "../auth/errors.js";
import { validateOAuth2ExchangePolicy } from "../auth/oauth2.js";
import { oauthEndpoint, providerParameters } from "../auth/token.js";
import {
  bounded,
  HTTP_METHODS,
  headerName,
  injectedHeaders,
  injectedParams,
  injectedPointers,
  placementsFor,
  refuseCredentialParams,
  resourceUrl,
  TARGET_RESPONSE_LIMIT_BYTES,
  TARGET_TIMEOUT_LIMIT_MS,
  TRANSPORT_HEADERS,
  targetBase,
} from "./policy.js";
import type {
  CredentialAuthentication,
  CredentialMethod,
  CredentialType,
} from "./types.js";

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

/**
 * Stored shape of a static secret: exactly its named parts, each a string,
 * the `optional` ones allowed to be absent. A Basic part may be empty (a
 * key as the username with no password, or the reverse); the transport
 * refuses an empty part anywhere else.
 */
export function staticSecretSchema(
  parts: readonly string[],
  optional: readonly string[] = [],
) {
  return t.Object(
    Object.fromEntries(
      parts.map((part) => [
        part,
        optional.includes(part) ? t.Optional(t.String()) : t.String(),
      ]),
    ),
    { additionalProperties: false },
  );
}

export const OAuthGrantSchema = t.Object(
  {
    tokens: t.Partial(OAuthTokensSchema),
    revision: t.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

/** The shape of a strict object schema, as the registry inspects it. */
type ObjectSchema = {
  type?: string;
  additionalProperties?: boolean;
  properties?: Record<string, { type?: string }>;
  required?: string[];
};

function identifier(value: string): void {
  if (typeof value !== "string" || !/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(value))
    throw new AuthError("invalid_definition");
}

/**
 * A static secret's parts and placements agree with each other, with the
 * stored shape and with the method's targets: the stored field holds
 * exactly the declared parts, each a string, required unless optional;
 * every placement names a declared part and only declared targets; every
 * part is placed; and on each target at least one placement signs, no
 * header, query parameter or JSON pointer is claimed twice, and at most
 * one part takes the one path position.
 */
function validateStatic(
  auth: Extract<CredentialAuthentication, { kind: "static" }>,
  stored: unknown,
  targets: string[],
): void {
  const parts = auth.parts;
  if (
    !Array.isArray(parts) ||
    !parts.length ||
    new Set(parts).size !== parts.length ||
    !Array.isArray(auth.placements) ||
    !auth.placements.length
  )
    throw new AuthError("invalid_definition");
  for (const part of parts) identifier(part);
  const optional = auth.optionalParts ?? [];
  if (
    !Array.isArray(optional) ||
    new Set(optional).size !== optional.length ||
    optional.some((part) => !parts.includes(part))
  )
    throw new AuthError("invalid_definition");
  const shape = stored as ObjectSchema;
  if (
    shape?.type !== "object" ||
    shape.additionalProperties !== false ||
    !shape.properties ||
    Object.keys(shape.properties).sort().join() !== [...parts].sort().join() ||
    Object.values(shape.properties).some((part) => part.type !== "string") ||
    [...(shape.required ?? [])].sort().join() !==
      parts
        .filter((part) => !optional.includes(part))
        .sort()
        .join()
  )
    throw new AuthError("invalid_definition");
  const used = new Set<string>();
  const place = (part: unknown) => {
    if (typeof part !== "string" || !parts.includes(part))
      throw new AuthError("invalid_definition");
    used.add(part);
  };
  for (const placement of auth.placements) {
    if (
      placement.targets !== undefined &&
      (!Array.isArray(placement.targets) ||
        !placement.targets.length ||
        placement.targets.some((target) => !targets.includes(target)))
    )
      throw new AuthError("invalid_definition");
    if (placement.in === "header" || placement.in === "jwt") {
      place(placement.part);
      headerName(placement.name);
      if (
        placement.prefix !== undefined &&
        (typeof placement.prefix !== "string" ||
          !/^[\x21-\x7e][\x20-\x7e]{0,31}$/.test(placement.prefix))
      )
        throw new AuthError("invalid_definition");
      if (
        placement.in === "jwt" &&
        (typeof placement.audience !== "string" ||
          !/^[\x21-\x7e]{1,64}$/.test(placement.audience))
      )
        throw new AuthError("invalid_definition");
    } else if (placement.in === "querySignature") {
      place(placement.part);
      headerName(placement.name);
    } else if (placement.in === "jsonPointer") {
      place(placement.part);
      if (
        typeof placement.pointer !== "string" ||
        !/^(\/[A-Za-z0-9_.-]+)+$/.test(placement.pointer)
      )
        throw new AuthError("invalid_definition");
    } else if (placement.in === "query" || placement.in === "body") {
      place(placement.part);
      identifier(placement.name);
    } else if (placement.in === "path") {
      place(placement.part);
      if (
        placement.prefix !== undefined &&
        (typeof placement.prefix !== "string" ||
          !/^[A-Za-z0-9._~-]{1,32}$/.test(placement.prefix))
      )
        throw new AuthError("invalid_definition");
    } else if (placement.in === "basic") {
      place(placement.username);
      place(placement.password);
    } else throw new AuthError("invalid_definition");
  }
  if (used.size !== parts.length) throw new AuthError("invalid_definition");
  for (const target of targets) {
    const placed = placementsFor(auth, target);
    const headers = injectedHeaders(auth, target);
    const params = injectedParams(auth, target).map((name) =>
      name.toLowerCase(),
    );
    const pointers = injectedPointers(auth, target);
    if (
      !placed.length ||
      new Set(headers).size !== headers.length ||
      new Set(params).size !== params.length ||
      new Set(pointers).size !== pointers.length ||
      placed.filter((placement) => placement.in === "path").length > 1
    )
      throw new AuthError("invalid_definition");
  }
}

function validateMethod(method: CredentialMethod): void {
  const schema = method.schema as ObjectSchema;
  if (
    schema.type !== "object" ||
    schema.additionalProperties !== false ||
    !schema.properties
  )
    throw new AuthError("invalid_definition");
  const auth = method.authentication;
  if (auth.kind === "none") {
    // Nothing is stored for a method that signs nothing.
    if (Object.keys(schema.properties).length)
      throw new AuthError("invalid_definition");
  } else {
    identifier(auth.field);
    if (!Object.hasOwn(schema.properties, auth.field))
      throw new AuthError("invalid_definition");
  }
  if (auth.kind === "static")
    validateStatic(
      auth,
      schema.properties[auth.field],
      Object.keys(method.targets ?? {}),
    );
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
          "client_id_basic",
          "client_secret_basic",
          "client_secret_post",
        ].includes(endpoint.clientAuthentication) ||
        (endpoint.encoding !== undefined &&
          !["form", "json"].includes(endpoint.encoding))
      )
        throw new AuthError("invalid_definition");
    }
  } else if (auth.kind !== "none") throw new AuthError("invalid_definition");
  if (!Object.keys(method.targets).length)
    throw new AuthError("invalid_definition");
  for (const [name, target] of Object.entries(method.targets)) {
    identifier(name);
    const injected = injectedHeaders(auth, name);
    targetBase(target);
    if (
      !Array.isArray(target.methods) ||
      !target.methods.length ||
      target.methods.some((m) => !HTTP_METHODS.includes(m))
    )
      throw new AuthError("invalid_definition");
    if (
      (target.allowedHeaders !== undefined &&
        !Array.isArray(target.allowedHeaders)) ||
      (target.timeoutMs !== undefined &&
        !bounded(target.timeoutMs, TARGET_TIMEOUT_LIMIT_MS)) ||
      (target.maxResponseBytes !== undefined &&
        !bounded(target.maxResponseBytes, TARGET_RESPONSE_LIMIT_BYTES)) ||
      (target.encodedSlashes !== undefined &&
        typeof target.encodedSlashes !== "boolean")
    )
      throw new AuthError("invalid_definition");
    for (const allowed of target.allowedHeaders ?? []) {
      const header = headerName(allowed);
      if (injected.includes(header) || TRANSPORT_HEADERS.includes(header))
        throw new AuthError("invalid_definition");
    }
    // A path part is inserted into the request URL alone; a Destination on
    // the same target would name a resource outside the signed position.
    if (
      auth.kind === "static" &&
      (target.methods.includes("COPY") || target.methods.includes("MOVE")) &&
      placementsFor(auth, name).some((placement) => placement.in === "path")
    )
      throw new AuthError("invalid_definition");
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
        injected.includes(header) ||
        TRANSPORT_HEADERS.includes(header) ||
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
    refuseCredentialParams(
      resourceUrl(target, probe.path),
      injectedParams(auth, probe.target),
    );
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
