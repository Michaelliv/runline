/**
 * Google Analytics over REST: one signed request path for its two APIs,
 * the Data API that runs reports and the Admin API that configures
 * accounts and properties, and the names both address resources by.
 */
import {
  type ActionContext,
  AuthError,
  jsonAnswer,
  pathSegment,
  responseFailed,
} from "runline";
import * as t from "typebox";
import { failedChange, unansweredChange } from "../../_shared/changes.js";
import { googleFailure, googleJsonResponse } from "../../_shared/googleAuth.js";
import { maskedFields } from "../../_shared/googleFieldMask.js";
import { STRICT } from "../../_shared/schemas.js";

export const PLUGIN = "googleAnalytics";
/**
 * Reading reports and configuration, and changing configuration. Every
 * Data API method takes the first; every Admin API change needs the
 * second.
 */
export const SCOPES = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/analytics.edit",
];
/** Both APIs at v1beta, the stable channel; v1alpha methods can change. */
const BASES = {
  data: "https://analyticsdata.googleapis.com/v1beta/",
  admin: "https://analyticsadmin.googleapis.com/v1beta/",
} as const;

// ─── Names ──────────────────────────────────────────────────────

/**
 * A top-level resource a call names by its numeric ID or by its resource
 * name, as account summaries answer it (`properties/1234`).
 */
function root(collection: string, what: string) {
  const pattern = new RegExp(`^(${collection}/)?\\d+$`);
  return {
    pattern,
    schema: (description: string, options: { env?: string } = {}) =>
      t.String({
        pattern: pattern.source,
        description: `${description}: ${what} ID (1234) or resource name (${collection}/1234)`,
        ...options,
      }),
    /** The resource name, whichever way the value names it. */
    name: (value: string) =>
      `${collection}/${pathSegment(value.slice(value.lastIndexOf("/") + 1))}`,
  };
}

const PROPERTY = root("properties", "property");
const ACCOUNT = root("accounts", "account");

export const accountId = ACCOUNT.schema("The Analytics account");
export const accountName = ACCOUNT.name;
/** A property, described by what the input names it for. */
export const propertySchema = PROPERTY.schema;
/** The property a call is about, where the connection may name it. */
export const propertyId = t.Optional(
  propertySchema("The property the call is about, unless the connection's"),
);

/**
 * `properties/{id}` of the property a call is about: the call's own, else
 * the connection's.
 */
export function propertyName(ctx: ActionContext, propertyId?: string): string {
  const value = propertyId ?? ctx.connection.config.propertyId;
  if (value === undefined || value === "")
    throw new Error(
      "googleAnalytics: propertyId is required: pass it, or set it on the connection (accountSummary.list finds it)",
    );
  if (typeof value !== "string" || !PROPERTY.pattern.test(value))
    throw new Error(
      "googleAnalytics: propertyId must be a numeric property ID or properties/<id>",
    );
  return PROPERTY.name(value);
}

/**
 * A property's child resource, named as the Admin API answers it
 * (`properties/1234/customDimensions/5678`). One template gives the input
 * its pattern and the request its path, so a name of any other shape
 * reaches neither.
 */
export function child(collection: string, what: string) {
  const template = ["properties", "*", collection, "*"];
  const schema = t.String({
    pattern: `^properties/[^/]+/${collection}/[^/]+$`,
    description: `The ${what}'s resource name, as its list answers it: properties/1234/${collection}/5678`,
  });
  return {
    collection,
    schema,
    /** The input of an action that takes the name alone. */
    named: t.Object({ name: schema }, STRICT),
    path(name: string): string {
      const segments = name.split("/");
      if (
        segments.length !== template.length ||
        template.some((part, at) => part !== "*" && part !== segments[at])
      )
        throw new AuthError("request_not_allowed");
      return segments.map(pathSegment).join("/");
    },
  };
}

// ─── Requests ───────────────────────────────────────────────────

interface AnalyticsCall {
  api: keyof typeof BASES;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** Beneath the API's `v1beta/`. */
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  /** The call changes configuration, so a lost answer leaves it unknown. */
  changes?: boolean;
}

/** What a report's refusal usually is: a name, or names that do not mix. */
const REPORT_HINT =
  "metadata.get lists the property's dimension and metric names, and report.checkCompatibility says which go together";
/** What Google's statuses mean for a call to either API. */
const HINTS: Record<string, string> = {
  RESOURCE_EXHAUSTED:
    "the property or the project is out of quota; returnPropertyQuota on a report answers what is left",
  "PERMISSION_DENIED.SERVICE_DISABLED":
    "the Cloud project has not enabled this Analytics API",
  "PERMISSION_DENIED.ACCESS_TOKEN_SCOPE_INSUFFICIENT":
    "the login was not granted the Analytics scope this call needs; connect again",
};

/**
 * A signed Analytics call that must succeed. A failure names Google's
 * status and reason, the request fields it faults, and what to do about
 * the ones worth a hint; a change that got no answer, or a 5xx, says its
 * outcome is unknown.
 */
export async function analytics<T = unknown>(
  ctx: ActionContext,
  call: AnalyticsCall,
): Promise<T> {
  let response: Response;
  try {
    response = await googleJsonResponse(
      ctx,
      PLUGIN,
      SCOPES,
      call.method ?? "GET",
      `${BASES[call.api]}${call.path}`,
      call.body,
      call.query,
    );
  } catch (error) {
    throw call.changes ? unansweredChange(error) : error;
  }
  if (!response.ok) {
    let code: unknown;
    const failure = await responseFailed(PLUGIN, response, (body) => {
      const envelope = googleFailure(body);
      code = envelope.code;
      return envelope;
    });
    const hint =
      typeof code !== "string"
        ? undefined
        : call.api === "data" && code === "INVALID_ARGUMENT"
          ? REPORT_HINT
          : (HINTS[code] ?? HINTS[code.split(".")[0]]);
    if (hint) failure.message += `: ${hint}`;
    throw call.changes ? failedChange(failure) : failure;
  }
  return jsonAnswer<T>(response);
}

/** A Data API method on a property: `properties/{id}:runReport`. */
export function report<T = unknown>(
  ctx: ActionContext,
  property: string,
  method: string,
  body: unknown,
): Promise<T> {
  return analytics<T>(ctx, {
    api: "data",
    method: "POST",
    path: `${property}:${method}`,
    body,
  });
}

/** An Admin API read. */
export function read<T = unknown>(
  ctx: ActionContext,
  path: string,
  query?: Record<string, unknown>,
): Promise<T> {
  return analytics<T>(ctx, { api: "admin", path, query });
}

/** An Admin API change. */
export function change<T = unknown>(
  ctx: ActionContext,
  call: Pick<AnalyticsCall, "path" | "body"> & {
    method: "POST" | "PATCH" | "DELETE";
  },
): Promise<T> {
  return analytics<T>(ctx, { api: "admin", changes: true, ...call });
}

/**
 * A partial update: the fields given, by their snake_case mask paths, and
 * the mask that names them.
 */
export function patch<T = unknown>(
  ctx: ActionContext,
  path: string,
  fields: Record<string, unknown>,
): Promise<T> {
  const { body, updateMask } = maskedFields(fields);
  return analytics<T>(ctx, {
    api: "admin",
    method: "PATCH",
    path,
    query: { updateMask },
    body,
    changes: true,
  });
}

/** One page of an Admin API list. */
export const paging = {
  pageSize: t.Optional(
    t.Integer({
      minimum: 1,
      maximum: 200,
      description: "The most to answer in one page (default 50)",
    }),
  ),
  pageToken: t.Optional(
    t.String({
      minLength: 1,
      description:
        "nextPageToken of the page before, with every other input the same",
    }),
  ),
};

// ─── Report tables ──────────────────────────────────────────────

type Header = { name?: unknown };
type Value = { value?: unknown };
type Row = { dimensionValues?: Value[]; metricValues?: Value[] };

/** A report's answer: the parts that hold rows, beside whatever else. */
export interface ReportTable {
  [key: string]: unknown;
  dimensionHeaders?: Header[];
  metricHeaders?: Header[];
  rows?: Row[];
  totals?: Row[];
  maximums?: Row[];
  minimums?: Row[];
}

const keyed = (headers: Header[] = [], values: Value[] = []) =>
  Object.fromEntries(
    headers.map((header, at) => [String(header.name), values[at]?.value]),
  );

/**
 * A report with each row's values under the names of their columns, as
 * `{ dimensions: { country: "Israel" }, metrics: { activeUsers: "12" } }`,
 * where the API answers them by position. The headers stay, for each
 * metric's type; so does everything else the report answers.
 */
export function table<T extends ReportTable>(answer: T) {
  const rows = (list: Row[] | undefined) =>
    list?.map((row) => ({
      dimensions: keyed(answer.dimensionHeaders, row.dimensionValues),
      metrics: keyed(answer.metricHeaders, row.metricValues),
    }));
  return {
    ...answer,
    ...Object.fromEntries(
      (["rows", "totals", "maximums", "minimums"] as const).flatMap((key) =>
        answer[key] === undefined ? [] : [[key, rows(answer[key])]],
      ),
    ),
  };
}
