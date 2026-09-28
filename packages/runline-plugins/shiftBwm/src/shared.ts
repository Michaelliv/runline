import { type ActionContext, AuthError, type HttpMethod } from "runline";
import * as t from "typebox";
import { credentialBroker } from "../../_shared/credentialAdapter.js";
import {
  SHIFT_API_URL,
  STRICT_OBJECT,
  shiftErrorMessage,
  shiftIdentifier,
} from "../../_shared/shiftCloud.js";
import { shiftCredential, shiftPath } from "../../_shared/shiftCredentials.js";
import {
  BusinessWorldModelClient,
  BwmClientError,
  type BwmFetch,
} from "./vendor/client.js";
import {
  BWM_BUILT_IN_OBJECT_TYPES,
  BWM_LIST_MAX_LIMIT,
} from "./vendor/contracts.js";
import { BwmFilterOperator } from "./vendor/models.js";

export {
  idSchema,
  STRICT_OBJECT,
  STRICT_UPDATE_OBJECT,
} from "../../_shared/shiftCloud.js";

export type Ctx = ActionContext;

export const shiftBwmCredential = shiftCredential();

// ─── client ──────────────────────────────────────────────────────

/**
 * The vendored client's fetch, sent through the declared credential: the
 * client names Shift API URLs, and each becomes a path beneath the Shift
 * target. The client never holds the key.
 */
function brokeredFetch(ctx: Ctx): BwmFetch {
  return (input, init) => {
    const url = new URL(input);
    if (url.origin !== SHIFT_API_URL)
      throw new AuthError("request_not_allowed");
    return credentialBroker(ctx, shiftBwmCredential).request({
      target: "api",
      path: `${shiftPath(url.pathname)}${url.search}`,
      method: (init?.method ?? "GET") as HttpMethod,
      headers: {
        Accept: "application/json",
        ...Object.fromEntries(init?.headers ?? []),
      },
      ...(init?.body !== undefined ? { body: init.body } : {}),
    });
  };
}

/**
 * One client per call. Cheap (prefix + fetch closure), and it lets a
 * create attach its own `Idempotency-Key` without leaking it into the
 * next request.
 */
export function clientFor(
  ctx: Ctx,
  extraHeaders: Record<string, string> = {},
): BusinessWorldModelClient {
  return new BusinessWorldModelClient({
    baseUrl: SHIFT_API_URL,
    fetch: brokeredFetch(ctx),
    headers: extraHeaders,
  });
}

/** Client whose every mutation carries a fresh `Idempotency-Key`. */
export function idempotentClientFor(ctx: Ctx): BusinessWorldModelClient {
  return clientFor(ctx, { "idempotency-key": crypto.randomUUID() });
}

// ─── errors ──────────────────────────────────────────────────────

/**
 * Only `message` survives the trip back to the agent's code, so the
 * fields the model needs to self-correct — `code` and `param` — are
 * folded into it, as for every Shift plugin. `param` names the offending
 * request location (`fields.tier`, `relationships.$owner`). The service's
 * free-text message can echo request data and is not returned.
 */
export function describeError(err: unknown): Error {
  if (err instanceof BwmClientError) {
    const code = shiftIdentifier(err.code);
    const param = shiftIdentifier(err.param);
    const error = new Error(
      shiftErrorMessage("shiftBwm", err.status, code, param),
    ) as Error & {
      status: number;
      type?: string;
      code?: string;
      param?: string;
    };
    error.status = err.status;
    error.type = shiftIdentifier(err.type);
    error.code = code;
    error.param = param;
    return error;
  }
  return err instanceof Error ? err : new Error(String(err));
}

export async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw describeError(err);
  }
}

/**
 * Every update is compare-and-set on `updatedAt`; a lost race is
 * `409 write_conflict`. The API asks the loser to re-read and retry,
 * so an update runs once more after a conflict before it fails.
 */
export async function withConflictRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BwmClientError && err.code === "write_conflict") {
      return await fn();
    }
    throw err;
  }
}

// ─── schema helpers ──────────────────────────────────────────────

export function objectTypeSchema(
  description = `Object type: ${BWM_BUILT_IN_OBJECT_TYPES.join(" | ")} or a custom type's slug (see objectType.list).`,
) {
  return t.String({ minLength: 1, pattern: "^[a-z][a-z0-9_]*$", description });
}

export const idOrIds = t.Union([
  t.String({ minLength: 1 }),
  t.Array(t.String({ minLength: 1 })),
]);

/** Link changes on one relationship key, as records and lists both take them. */
export const relationshipChangeSchema = t.Union([
  idOrIds,
  t.Object(
    {
      add: t.Optional(idOrIds),
      remove: t.Optional(idOrIds),
      replace: t.Optional(t.Union([idOrIds, t.Null()])),
    },
    STRICT_OBJECT,
  ),
]);

export const principalSchema = t.Object(
  {
    type: t.Union([t.Literal("user"), t.Literal("service")], {
      description: "user: a member (see member.list). service: an API key.",
    }),
    id: t.String({ minLength: 1 }),
  },
  STRICT_OBJECT,
);

export function fieldsWriteSchema(description: string) {
  return t.Record(t.String(), t.Unknown(), { description });
}

export function relationshipsCreateSchema() {
  return t.Record(t.String(), idOrIds, {
    description:
      "Relationship key -> record id (HAS_ONE) or array of ids (HAS_MANY). System keys are $-prefixed ($owner, $account, $contact, $attendee, $assignedTo, $files); custom keys are bare slugs.",
  });
}

export function relationshipsUpdateSchema() {
  return t.Record(t.String(), t.Union([relationshipChangeSchema, t.Null()]), {
    description:
      "Relationship key -> { add, remove, replace } ops, or a bare id / id array as shorthand for replace, or null to clear. At most 25 link changes per request.",
  });
}

export function visibilitySchema() {
  return t.Object(
    {
      mode: t.Union(
        [t.Literal("org"), t.Literal("group"), t.Literal("private")],
        {
          description:
            "org: every member. group: members of the named groups. private: only the named principals. The actor who restricts a record is always a reader.",
        },
      ),
      groups: t.Optional(t.Array(t.String({ minLength: 1 }))),
      principals: t.Optional(t.Array(principalSchema)),
    },
    STRICT_OBJECT,
  );
}

export function paginationFields() {
  return {
    limit: t.Optional(
      t.Integer({
        minimum: 1,
        maximum: BWM_LIST_MAX_LIMIT,
        description: `Page size, default 25, max ${BWM_LIST_MAX_LIMIT}`,
      }),
    ),
    offset: t.Optional(t.Integer({ minimum: 0, description: "Default 0" })),
  };
}

export function filtersSchema() {
  const operators = BwmFilterOperator.options;
  return t.Array(
    t.Object(
      {
        key: t.String({
          minLength: 1,
          description:
            "Field or relationship key, e.g. $name, $email, tier, $account",
        }),
        operator: t.Optional(
          t.Union(
            operators.map((op) => t.Literal(op)),
            {
              description: `${operators.join(" | ")}. Omit it and the API picks equal where valid, contains otherwise. Multi-value fields (EMAIL, TELEPHONE, URL) reject equal (unsupported_filter_operator): omit the operator or use contains.`,
            },
          ),
        ),
        negate: t.Optional(t.Boolean({ description: "Negate the operator" })),
        value: t.String({
          description:
            "Comparison value. For relationship keys, a related record id.",
        }),
      },
      STRICT_OBJECT,
    ),
    { description: "AND-ed filters" },
  );
}

/** The record envelope, as every read returns it and as descriptions cite it. */
export const ENVELOPE_DOC = `Record envelope: { id, objectType, createdAt, updatedAt, archivedAt, mergedIntoId, externalId, visibility: { mode, groups, principals }, fields: { "<key>": { value, valueType } }, relationships: { "<key>": { cardinality, objectType, values: [ids] } } }. System keys are $-prefixed ($name, $email, $owner, $account, $stage, ...); custom keys are bare slugs. Writes take bare values: fields: { "$name": "Acme" }, relationships: { "$owner": "user_1", "$contact": ["con_1"] }.`;
