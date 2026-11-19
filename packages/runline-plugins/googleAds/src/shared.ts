/**
 * The Google Ads API over REST: one signed request path, Google Ads Query
 * Language (GAQL) searches read page by page, and every change sent
 * through GoogleAdsService.Mutate.
 */
import {
  type ActionContext,
  errorIdentifier,
  jsonAnswer,
  pathSegment,
  responseFailed,
} from "runline";
import * as t from "typebox";
import { failedChange, unansweredChange } from "../../_shared/changes.js";
import { googleFailure, googleResponse } from "../../_shared/googleAuth.js";
import { GOOGLE_ADS_VERSION } from "../../_shared/googleCredentials.js";
import { maskedFields } from "../../_shared/googleFieldMask.js";
import { arr, obj } from "../../_shared/provider.js";
import { stringEnum } from "../../_shared/schemas.js";

export const PLUGIN = "googleAds";
/**
 * The one Google Ads scope. It covers reading and changing alike: what a
 * login may do is its user role on each account, not its scope.
 */
export const SCOPES = ["https://www.googleapis.com/auth/adwords"];
const BASE = `https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}/`;

// ─── Inputs ─────────────────────────────────────────────────────

const CUSTOMER_ID = /^\d{3}-?\d{3}-?\d{4}$/;
/** A Google Ads customer ID, with or without its hyphens. */
export const customerIdSchema = (
  description: string,
  options: { env?: string } = {},
) => t.String({ pattern: CUSTOMER_ID.source, description, ...options });

/** The account a call reads or changes, and the manager it acts through. */
export const account = {
  customerId: customerIdSchema(
    "Google Ads customer ID, with or without hyphens (123-456-7890)",
  ),
  loginCustomerId: t.Optional(
    customerIdSchema(
      "Manager account the call acts through (the login-customer-id header), in place of the connection's. Omit when the login has direct access to customerId.",
    ),
  ),
};
export type Account = t.Static<t.TObject<typeof account>>;

/** A resource's numeric ID, as Google Ads returns it. */
export const resourceId = (what: string) =>
  t.String({ pattern: "^[1-9]\\d*$", description: `${what} ID` });

const STATUSES = ["ENABLED", "PAUSED", "REMOVED"] as const;
export type Status = (typeof STATUSES)[number];
/** The status a list is filtered to; REMOVED is listed only when asked for. */
export const statusFilter = t.Optional(
  stringEnum(STATUSES, {
    description: "Only this status (default: every status but REMOVED)",
  }),
);
/** A status a change may set; removing is its own action. */
export const servingStatus = (what: string) =>
  stringEnum(["ENABLED", "PAUSED"] as const, {
    description: `ENABLED serves the ${what}, PAUSED stops it`,
  });

/** Integer micros: 1,000,000 micros are one unit of the account's currency. */
export const micros = (description: string) =>
  t.Integer({ minimum: 0, description: `${description}, in micros` });

/** GAQL's date-range functions. */
const DATE_RANGES = [
  "TODAY",
  "YESTERDAY",
  "LAST_7_DAYS",
  "LAST_14_DAYS",
  "LAST_30_DAYS",
  "LAST_BUSINESS_WEEK",
  "LAST_MONTH",
  "LAST_WEEK_MON_SUN",
  "LAST_WEEK_SUN_SAT",
  "THIS_MONTH",
  "THIS_WEEK_MON_TODAY",
  "THIS_WEEK_SUN_TODAY",
] as const;
const day = (description: string) =>
  t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$", description });

/** The period a list reports metrics for; without one it reports none. */
export const period = {
  dateRange: t.Optional(
    stringEnum(DATE_RANGES, {
      description: "Report metrics for this period",
    }),
  ),
  startDate: t.Optional(
    day("Report metrics from this day (YYYY-MM-DD), with endDate"),
  ),
  endDate: t.Optional(
    day("Report metrics through this day (YYYY-MM-DD), with startDate"),
  ),
};
export type Period = t.Static<t.TObject<typeof period>>;
/** A period is a dateRange, or startDate with endDate, or none at all. */
export const PERIOD_RULE = {
  anyOf: [
    {
      not: {
        anyOf: [
          { required: ["dateRange"] },
          { required: ["startDate"] },
          { required: ["endDate"] },
        ],
      },
    },
    {
      required: ["dateRange"],
      not: { anyOf: [{ required: ["startDate"] }, { required: ["endDate"] }] },
    },
    { required: ["startDate", "endDate"], not: { required: ["dateRange"] } },
  ],
};

export const limit = t.Optional(
  t.Integer({ minimum: 1, description: "Stop after this many (default all)" }),
);

// ─── Requests ───────────────────────────────────────────────────

function customerDigits(customerId: string): string {
  return customerId.replaceAll("-", "");
}

/** `customers/{id}`, the start of every path and resource name in an account. */
export function customerPath(customerId: string): string {
  return `customers/${pathSegment(customerDigits(customerId))}`;
}

/**
 * The manager a call acts through: the call's own, else the connection's.
 * Without one, Google Ads authorizes the login against the account itself.
 */
function loginHeader(
  ctx: ActionContext,
  loginCustomerId: string | undefined,
): Record<string, string> {
  const value = loginCustomerId ?? ctx.connection.config.loginCustomerId;
  if (value === undefined || value === "") return {};
  if (typeof value !== "string" || !CUSTOMER_ID.test(value))
    throw new Error(
      "googleAds: loginCustomerId must be a 10-digit customer ID",
    );
  return { "login-customer-id": customerDigits(value) };
}

interface AdsCall {
  method?: "GET" | "POST";
  /** Beneath `https://googleads.googleapis.com/<version>/`. */
  path: string;
  body?: unknown;
  /** The account the call is about; only such calls name a manager. */
  account?: Account;
  /** The call changes the account, so a lost answer leaves it unknown. */
  changes?: boolean;
}

/**
 * A GoogleAdsFailure: each error's code as `<type>.<value>`
 * (`queryError.UNRECOGNIZED_FIELD`) and the request field it concerns
 * (`mutateOperations.0.campaignOperation.update.name`). A failure that
 * carries none reads as any Google API's does. The messages are never
 * read: they can echo what was sent.
 */
export function adsFailure(body: unknown): { code?: unknown; param?: unknown } {
  const error = obj(obj(body).error);
  const errors = arr(error.details).flatMap((detail) =>
    arr(obj(detail).errors).map(obj),
  );
  const fields = errors
    .map((entry) => fieldPath(entry.location))
    .filter((field): field is string => field !== undefined);
  return {
    code:
      errors.map((entry) => errorCode(entry.errorCode)).find(Boolean) ??
      googleFailure(body).code,
    param: [...new Set(fields)],
  };
}

/** `{ queryError: "UNRECOGNIZED_FIELD" }` as `queryError.UNRECOGNIZED_FIELD`. */
function errorCode(value: unknown): string | undefined {
  const [entry] = Object.entries(obj(value));
  return entry && typeof entry[1] === "string"
    ? `${entry[0]}.${entry[1]}`
    : undefined;
}

function fieldPath(location: unknown): string | undefined {
  const names = arr(obj(location).fieldPathElements)
    .map(obj)
    .flatMap((element) =>
      typeof element.fieldName !== "string"
        ? []
        : typeof element.index === "number"
          ? [`${element.fieldName}.${element.index}`]
          : [element.fieldName],
    );
  return names.length ? names.join(".") : undefined;
}

/**
 * A signed Google Ads call that must succeed. A failure names Google's
 * error code, the fields it concerns and the request-id support asks for;
 * a change that got no answer, or a 5xx, says its outcome is unknown.
 */
export async function adsRequest<T = unknown>(
  ctx: ActionContext,
  call: AdsCall,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(call.body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(call.account ? loginHeader(ctx, call.account.loginCustomerId) : {}),
  };
  let response: Response;
  try {
    response = await googleResponse(
      ctx,
      PLUGIN,
      SCOPES,
      `${BASE}${call.path}`,
      {
        method: call.method ?? "GET",
        headers,
        body: call.body === undefined ? undefined : JSON.stringify(call.body),
      },
    );
  } catch (error) {
    throw call.changes ? unansweredChange(error) : error;
  }
  if (!response.ok) {
    const failure = await responseFailed(PLUGIN, response, adsFailure);
    const requestId = errorIdentifier(response.headers.get("request-id"));
    if (requestId) failure.message += ` (request-id ${requestId})`;
    throw call.changes ? failedChange(failure) : failure;
  }
  return (await jsonAnswer(response)) as T;
}

type Page = { nextPageToken?: string } & Record<string, unknown>;

/**
 * Every item of a paged answer: the same request again with each page's
 * token, until the last page or `limit` items. Answers the pages too, for
 * what arrives beside the items.
 */
async function paginate(
  ctx: ActionContext,
  call: AdsCall & { body: Record<string, unknown> },
  key: string,
  limit: number | undefined,
): Promise<{ items: unknown[]; pages: Page[] }> {
  const items: unknown[] = [];
  const pages: Page[] = [];
  let pageToken: string | undefined;
  do {
    const page = await adsRequest<Page>(ctx, {
      ...call,
      body: pageToken ? { ...call.body, pageToken } : call.body,
    });
    pages.push(page);
    const found = page[key];
    if (Array.isArray(found)) items.push(...found);
    pageToken = page.nextPageToken;
  } while (pageToken && (limit === undefined || items.length < limit));
  return { items: limit === undefined ? items : items.slice(0, limit), pages };
}

interface SearchOptions {
  limit?: number;
  summaryRow?: boolean;
  totalResultsCount?: boolean;
}

/**
 * The rows a GAQL query matches, read 10,000 to a page. Pages after the
 * first cost no quota. The summary row comes with the last page, so a
 * `limit` that stops early can leave it out.
 */
export async function search(
  ctx: ActionContext,
  account: Account,
  query: string,
  options: SearchOptions = {},
) {
  const settings = {
    ...(options.summaryRow ? { returnSummaryRow: true } : {}),
    ...(options.totalResultsCount ? { returnTotalResultsCount: true } : {}),
  };
  const { items, pages } = await paginate(
    ctx,
    {
      method: "POST",
      path: `${customerPath(account.customerId)}/googleAds:search`,
      body: {
        query,
        ...(Object.keys(settings).length ? { searchSettings: settings } : {}),
      },
      account,
    },
    "results",
    options.limit,
  );
  const reported = (key: string) =>
    pages.find((page) => page[key] !== undefined)?.[key];
  const fieldMask = reported("fieldMask");
  const totalResultsCount = reported("totalResultsCount");
  const summaryRow = reported("summaryRow");
  return {
    results: items,
    ...(fieldMask === undefined ? {} : { fieldMask }),
    ...(totalResultsCount === undefined ? {} : { totalResultsCount }),
    ...(summaryRow === undefined ? {} : { summaryRow }),
  };
}

/**
 * Every item of a paged call that is not a GAQL search. Such a call takes
 * a page size, so a `limit` asks for no more than it keeps.
 */
export async function collect(
  ctx: ActionContext,
  call: AdsCall & { body: Record<string, unknown> },
  limit: number | undefined,
): Promise<unknown[]> {
  const body =
    limit === undefined ? call.body : { ...call.body, pageSize: limit };
  return (
    await paginate(ctx, { ...call, method: "POST", body }, "results", limit)
  ).items;
}

/** A GAQL query from its clauses; empty conditions drop out. */
export function gaql(query: {
  select: string[];
  from: string;
  where?: (string | undefined)[];
  orderBy?: string;
  limit?: number;
}): string {
  const where = (query.where ?? []).filter(
    (condition): condition is string => condition !== undefined,
  );
  return [
    `SELECT ${query.select.join(", ")}`,
    `FROM ${query.from}`,
    where.length ? `WHERE ${where.join(" AND ")}` : undefined,
    query.orderBy ? `ORDER BY ${query.orderBy}` : undefined,
    query.limit === undefined ? undefined : `LIMIT ${query.limit}`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The performance a list reports for a period. */
export const METRICS = [
  "metrics.impressions",
  "metrics.clicks",
  "metrics.ctr",
  "metrics.average_cpc",
  "metrics.cost_micros",
  "metrics.conversions",
  "metrics.conversions_value",
];

/** The period's condition on `segments.date`, or none without a period. */
export function periodCondition(p: Period): string | undefined {
  if (p.dateRange) return `segments.date DURING ${p.dateRange}`;
  if (p.startDate && p.endDate)
    return `segments.date BETWEEN '${p.startDate}' AND '${p.endDate}'`;
  return undefined;
}

/** A status filter's condition: the one asked for, or anything not removed. */
export function statusCondition(field: string, status?: Status): string {
  return status ? `${field} = '${status}'` : `${field} != 'REMOVED'`;
}

/** What a mutate answers for each operation. */
export const RESPONSE_CONTENT_TYPES = [
  "RESOURCE_NAME_ONLY",
  "MUTABLE_RESOURCE",
] as const;

export interface ChangeOptions extends Account {
  validateOnly?: boolean;
  partialFailure?: boolean;
  responseContentType?: (typeof RESPONSE_CONTENT_TYPES)[number];
}

/**
 * GoogleAdsService.Mutate: the operations run in one transaction (or each
 * on its own with partialFailure); validateOnly checks without applying.
 * Options left undefined drop out of the JSON body.
 */
export async function mutate(
  ctx: ActionContext,
  options: ChangeOptions,
  mutateOperations: unknown[],
): Promise<unknown> {
  const { validateOnly, partialFailure, responseContentType } = options;
  return adsRequest(ctx, {
    method: "POST",
    path: `${customerPath(options.customerId)}/googleAds:mutate`,
    body: {
      mutateOperations,
      partialFailure,
      validateOnly,
      responseContentType,
    },
    account: options,
    changes: validateOnly !== true,
  });
}

/**
 * `customers/{id}/{collection}/{key}`, a resource a change names. A
 * resource whose ID is unique only within its parent has a composite key,
 * the parent's ID and its own joined by `~` (`adGroupAds/123~45678`).
 */
export function resourceName(
  customerId: string,
  collection: string,
  ...ids: string[]
): string {
  return `customers/${customerDigits(customerId)}/${collection}/${ids.join("~")}`;
}

/** An update operation: the fields given, and the mask that names them. */
export function update(
  name: string,
  fields: Record<string, unknown>,
): { update: Record<string, unknown>; updateMask: string } {
  const { body, updateMask } = maskedFields(fields);
  return { update: { resourceName: name, ...body }, updateMask };
}

export const validateOnly = t.Optional(
  t.Boolean({ description: "Check the change without applying it" }),
);
