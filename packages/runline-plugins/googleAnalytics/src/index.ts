/**
 * Google Analytics plugin for runline, on the Analytics Data API and the
 * Analytics Admin API (both v1beta), for Google Analytics 4 properties.
 *
 * Reports are the Data API's: `report.run` for a table of dimensions and
 * metrics over date ranges, `report.runPivot` for a pivot table,
 * `report.runRealtime` for the last half hour. A request is the API's own
 * JSON, with dimensions and metrics named by their API names;
 * `metadata.get` lists the names a property takes. A report's rows answer
 * their values under those names; a pivot report keeps the API's shape.
 *
 * Configuration is the Admin API's: accounts, properties, data streams,
 * custom dimensions and metrics, key events. A property's child resource
 * is named as its list answers it (`properties/1234/customDimensions/5678`),
 * and a list answers one page, with `nextPageToken` while another follows.
 *
 * The login is Google's OAuth, shared with the other Google plugins. A
 * connection may name the property its calls are about.
 */
import type { ActionContext, RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { googleCredential, googleOAuth } from "../../_shared/googleAuth.js";
import {
  googleConnection,
  RawGoogleObject,
} from "../../_shared/googleSchemas.js";
import { atLeastOne, exactlyOne, stringEnum } from "../../_shared/schemas.js";
import {
  accountId,
  accountName,
  analytics,
  change,
  child,
  PLUGIN,
  paging,
  patch,
  propertyId,
  propertyName,
  propertySchema,
  type ReportTable,
  read,
  report,
  SCOPES,
  STRICT,
  table,
} from "./shared.js";

type In<S extends t.TSchema> = t.Static<S>;

// ─── Report inputs ──────────────────────────────────────────────

/** A part of a report request taken in the Data API's own JSON. */
const raw = (description: string) =>
  t.Object({}, { additionalProperties: true, description });
const apiName = t.String({ minLength: 1 });
const dimension = t.Union([
  apiName,
  t.Object({ name: apiName, dimensionExpression: RawGoogleObject }, STRICT),
]);
const metric = t.Union([
  apiName,
  t.Object(
    {
      name: apiName,
      expression: t.Optional(t.String({ minLength: 1 })),
      invisible: t.Optional(t.Boolean()),
    },
    STRICT,
  ),
]);
const dimensions = t.Optional(
  t.Array(dimension, {
    maxItems: 9,
    description:
      'Dimensions, by API name: ["date", "country"]. One built from others is an object: { name: "place", dimensionExpression: { concatenate: { dimensionNames: ["country", "city"], delimiter: ", " } } } (or lowerCase, upperCase: { dimensionName })',
  }),
);
const metrics = (minItems: 0 | 1) =>
  t.Array(metric, {
    minItems,
    maxItems: 10,
    description:
      'Metrics, by API name: ["activeUsers", "sessions"]. A derived one is an object: { name: "eventsPerUser", expression: "eventCount/totalUsers" }; invisible keeps a metric out of the columns, for a filter or an order to use',
  });

const FILTER =
  "One of { filter }, { andGroup: { expressions: [...] } }, { orGroup: { expressions: [...] } }, { notExpression: {...} }. A filter names its fieldName and one of stringFilter { matchType: EXACT | BEGINS_WITH | ENDS_WITH | CONTAINS | FULL_REGEXP | PARTIAL_REGEXP, value, caseSensitive }, inListFilter { values, caseSensitive }, numericFilter { operation: EQUAL | LESS_THAN | LESS_THAN_OR_EQUAL | GREATER_THAN | GREATER_THAN_OR_EQUAL, value: { int64Value } or { doubleValue } }, betweenFilter { fromValue, toValue }, emptyFilter {}";
const filters = {
  dimensionFilter: t.Optional(
    raw(`Only rows whose dimensions match. ${FILTER}`),
  ),
  metricFilter: t.Optional(
    raw(
      "Only rows whose metrics match, applied after the rows are aggregated; the same shape as dimensionFilter",
    ),
  ),
};
const orderBys = t.Optional(
  t.Array(RawGoogleObject, {
    minItems: 1,
    description:
      'How rows are ordered: { metric: { metricName: "sessions" }, desc: true }, or { dimension: { dimensionName: "date", orderType: ALPHANUMERIC | CASE_INSENSITIVE_ALPHANUMERIC | NUMERIC } }',
  }),
);
const metricAggregations = t.Optional(
  t.Array(stringEnum(["TOTAL", "MINIMUM", "MAXIMUM", "COUNT"] as const), {
    minItems: 1,
    description: "Also answer these aggregates of each metric",
  }),
);
const returnPropertyQuota = t.Optional(
  t.Boolean({
    description:
      "Also answer propertyQuota: the tokens and requests the property has left",
  }),
);

const day = (which: string) =>
  t.String({
    pattern: "^(\\d{4}-\\d{2}-\\d{2}|today|yesterday|\\d+daysAgo)$",
    description: `The ${which} day, inclusive: YYYY-MM-DD, today, yesterday or NdaysAgo, in the property's time zone`,
  });
const rangeName = t.Optional(
  t.String({
    minLength: 1,
    description:
      "A name for the range, answered in the dateRange dimension (default date_range_0, date_range_1, …)",
  }),
);
/** What a report covers: date ranges, or the cohorts of a cohort report. */
const period = {
  dateRanges: t.Optional(
    t.Array(
      t.Object(
        { startDate: day("first"), endDate: day("last"), name: rangeName },
        STRICT,
      ),
      {
        minItems: 1,
        maxItems: 4,
        description:
          "The days to report on. With several ranges, each row names its range in the dateRange dimension",
      },
    ),
  ),
  cohortSpec: t.Optional(
    raw(
      'A cohort report, in place of dateRanges, with the cohort dimension: { cohorts: [{ name, dimension: "firstSessionDate", dateRange: { startDate, endDate } }], cohortsRange: { granularity: DAILY | WEEKLY | MONTHLY, startOffset, endOffset }, cohortReportSettings: { accumulate } }',
    ),
  ),
};
/** What core and pivot reports both take. */
const common = {
  ...period,
  ...filters,
  currencyCode: t.Optional(
    t.String({
      pattern: "^[A-Z]{3}$",
      description:
        "ISO 4217 currency for money metrics (default the property's)",
    }),
  ),
  keepEmptyRows: t.Optional(
    t.Boolean({
      description: "Keep rows whose metrics are all 0",
    }),
  ),
  comparisons: t.Optional(
    t.Array(RawGoogleObject, {
      minItems: 1,
      description:
        'Compare segments of the data, each in its own rows: { name, dimensionFilter } or a saved { comparison: "comparisons/1234" }',
    }),
  ),
  returnPropertyQuota,
};
const reportFields = {
  dimensions,
  metrics: t.Optional(metrics(0)),
  ...common,
  orderBys,
  metricAggregations,
  limit: t.Optional(
    t.Integer({
      minimum: 1,
      maximum: 250000,
      description: "Rows to answer (default 10,000)",
    }),
  ),
  offset: t.Optional(
    t.Integer({
      minimum: 0,
      description:
        "Rows to skip, for the page after: the rows answered so far. rowCount is how many there are",
    }),
  ),
};
const pivotFields = {
  dimensions,
  metrics: metrics(1),
  ...common,
  pivots: t.Array(
    t.Object(
      {
        fieldNames: t.Array(apiName, {
          minItems: 1,
          description:
            "The dimensions this pivot shows, from the report's dimensions; dateRange compares the date ranges",
        }),
        limit: t.Integer({
          minimum: 1,
          description:
            "How many combinations of the pivot's dimension values to answer. The limits of a report's pivots, multiplied, may not pass 250,000",
        }),
        offset: t.Optional(t.Integer({ minimum: 0 })),
        orderBys,
        metricAggregations,
      },
      STRICT,
    ),
    {
      minItems: 1,
      description:
        "The pivots: each lays some of the dimensions out as rows or columns. A dimension shows only if a pivot names it, and no two pivots share one",
    },
  ),
};
const PERIOD_RULE = exactlyOne(period);

const reportRun = t.Object(
  { propertyId, ...reportFields },
  { ...STRICT, ...PERIOD_RULE },
);
const reportRunPivot = t.Object(
  { propertyId, ...pivotFields },
  { ...STRICT, ...PERIOD_RULE },
);
/** Several reports on one property, in one request. */
const batchOf = <F extends t.TProperties>(fields: F) =>
  t.Object(
    {
      propertyId,
      requests: t.Array(t.Object(fields, { ...STRICT, ...PERIOD_RULE }), {
        minItems: 1,
        maxItems: 5,
        description: "The reports, each as its own action takes it",
      }),
    },
    STRICT,
  );
const reportBatchRun = batchOf(reportFields);
const reportBatchRunPivot = batchOf(pivotFields);
const reportRunRealtime = t.Object(
  {
    propertyId,
    dimensions,
    metrics: t.Optional(metrics(0)),
    ...filters,
    orderBys,
    metricAggregations,
    limit: reportFields.limit,
    minuteRanges: t.Optional(
      t.Array(
        t.Object(
          {
            startMinutesAgo: t.Optional(
              t.Integer({
                minimum: 0,
                description: "The earliest minute, counted back from now",
              }),
            ),
            endMinutesAgo: t.Optional(
              t.Integer({
                minimum: 0,
                description:
                  "The latest minute, counted back from now (default 0)",
              }),
            ),
            name: rangeName,
          },
          STRICT,
        ),
        {
          minItems: 1,
          maxItems: 2,
          description: "The minutes to report on (default the last 30)",
        },
      ),
    ),
    returnPropertyQuota,
  },
  STRICT,
);
const reportCheckCompatibility = t.Object(
  {
    propertyId,
    dimensions,
    metrics: t.Optional(metrics(0)),
    ...filters,
    compatibilityFilter: t.Optional(
      stringEnum(["COMPATIBLE", "INCOMPATIBLE"] as const, {
        description: "Answer only the names that are, or are not, compatible",
      }),
    ),
  },
  STRICT,
);
const propertyOnly = t.Object({ propertyId }, STRICT);

type Named = string | { name: string };
/**
 * A report request as the Data API takes it: dimensions and metrics as
 * objects, whichever way the call names them.
 */
function request<R extends { dimensions?: Named[]; metrics?: Named[] }>(
  fields: R,
) {
  const named = (list: Named[] | undefined) =>
    list?.map((entry) => (typeof entry === "string" ? { name: entry } : entry));
  return {
    ...fields,
    dimensions: named(fields.dimensions),
    metrics: named(fields.metrics),
  };
}

// ─── Configuration inputs ───────────────────────────────────────

const displayName = (what: string, maxLength: number) =>
  t.String({
    minLength: 1,
    maxLength,
    description: `The ${what}'s name in the Analytics UI`,
  });
const description = t.String({
  maxLength: 150,
  description: "A description of it",
});
const page = t.Object(paging, STRICT);
const propertyPage = t.Object({ propertyId, ...paging }, STRICT);
/** One page of a collection a property holds. */
const listOf =
  (collection: string) =>
  (input: In<typeof propertyPage>, ctx: ActionContext) => {
    const { propertyId, ...query } = input;
    return read(ctx, `${propertyName(ctx, propertyId)}/${collection}`, query);
  };

const accountList = t.Object(
  {
    ...paging,
    showDeleted: t.Optional(
      t.Boolean({ description: "Also list accounts in the trash" }),
    ),
  },
  STRICT,
);
const accountGet = t.Object({ accountId }, STRICT);
const RFC3339 =
  "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$";
const changeHistory = t.Object(
  {
    accountId,
    propertyId: t.Optional(
      propertySchema("Only changes to this property or its children"),
    ),
    resourceType: t.Optional(
      t.Array(
        stringEnum([
          "ACCOUNT",
          "PROPERTY",
          "FIREBASE_LINK",
          "GOOGLE_ADS_LINK",
          "GOOGLE_SIGNALS_SETTINGS",
          "CONVERSION_EVENT",
          "MEASUREMENT_PROTOCOL_SECRET",
          "CUSTOM_DIMENSION",
          "CUSTOM_METRIC",
          "DATA_RETENTION_SETTINGS",
          "DISPLAY_VIDEO_360_ADVERTISER_LINK",
          "DISPLAY_VIDEO_360_ADVERTISER_LINK_PROPOSAL",
          "DATA_STREAM",
          "ATTRIBUTION_SETTINGS",
        ] as const),
        { minItems: 1, description: "Only changes to these kinds of resource" },
      ),
    ),
    action: t.Optional(
      t.Array(stringEnum(["CREATED", "UPDATED", "DELETED"] as const), {
        minItems: 1,
        description: "Only these kinds of change",
      }),
    ),
    actorEmail: t.Optional(
      t.Array(t.String({ minLength: 1 }), {
        minItems: 1,
        description: "Only changes made by these users",
      }),
    ),
    earliestChangeTime: t.Optional(
      t.String({
        pattern: RFC3339,
        description:
          "Only changes at or after this time (RFC 3339: 2026-11-01T00:00:00Z)",
      }),
    ),
    latestChangeTime: t.Optional(
      t.String({
        pattern: RFC3339,
        description: "Only changes at or before this time (RFC 3339)",
      }),
    ),
    ...paging,
  },
  STRICT,
);

const INDUSTRIES = [
  "AUTOMOTIVE",
  "BUSINESS_AND_INDUSTRIAL_MARKETS",
  "FINANCE",
  "HEALTHCARE",
  "TECHNOLOGY",
  "TRAVEL",
  "OTHER",
  "ARTS_AND_ENTERTAINMENT",
  "BEAUTY_AND_FITNESS",
  "BOOKS_AND_LITERATURE",
  "FOOD_AND_DRINK",
  "GAMES",
  "HOBBIES_AND_LEISURE",
  "HOME_AND_GARDEN",
  "INTERNET_AND_TELECOM",
  "LAW_AND_GOVERNMENT",
  "NEWS",
  "ONLINE_COMMUNITIES",
  "PEOPLE_AND_SOCIETY",
  "PETS_AND_ANIMALS",
  "REAL_ESTATE",
  "REFERENCE",
  "SCIENCE",
  "SPORTS",
  "JOBS_AND_EDUCATION",
  "SHOPPING",
] as const;
/** What a property's settings are, on creating it and on changing it. */
const propertySettings = {
  displayName: displayName("property", 100),
  timeZone: t.String({
    minLength: 1,
    description:
      "Reporting time zone, the day boundary of every report (IANA: America/New_York). A change applies to data from then on",
  }),
  currencyCode: t.String({
    pattern: "^[A-Z]{3}$",
    description: "ISO 4217 currency of the property's money values",
  }),
  industryCategory: stringEnum(INDUSTRIES),
};
const propertyList = t.Object(
  {
    filter: t.String({
      minLength: 1,
      description:
        "Which properties: parent:accounts/123 (an account's own), ancestor:accounts/123 (every property under it), parent:properties/123 (a property's subproperties) or firebase_project:my-project",
    }),
    showDeleted: t.Optional(
      t.Boolean({ description: "Also list properties in the trash" }),
    ),
    ...paging,
  },
  STRICT,
);
const propertyCreate = t.Object(
  {
    accountId,
    displayName: propertySettings.displayName,
    timeZone: propertySettings.timeZone,
    currencyCode: t.Optional(propertySettings.currencyCode),
    industryCategory: t.Optional(propertySettings.industryCategory),
  },
  STRICT,
);
const propertyChanges = {
  displayName: t.Optional(propertySettings.displayName),
  timeZone: t.Optional(propertySettings.timeZone),
  currencyCode: t.Optional(propertySettings.currencyCode),
  industryCategory: t.Optional(propertySettings.industryCategory),
};
const propertyUpdate = t.Object(
  { propertyId, ...propertyChanges },
  { ...STRICT, ...atLeastOne(propertyChanges) },
);
/** The property itself, whatever the connection's is: trashing is named. */
const propertyDelete = t.Object(
  { propertyId: propertySchema("The property to trash") },
  STRICT,
);

const RETENTION = [
  "TWO_MONTHS",
  "FOURTEEN_MONTHS",
  "TWENTY_SIX_MONTHS",
  "THIRTY_EIGHT_MONTHS",
  "FIFTY_MONTHS",
] as const;
const retention = {
  eventDataRetention: t.Optional(
    stringEnum(RETENTION, { description: "How long event data is kept" }),
  ),
  userDataRetention: t.Optional(
    stringEnum(RETENTION, { description: "How long user data is kept" }),
  ),
  resetUserDataOnNewActivity: t.Optional(
    t.Boolean({
      description: "Start a user's retention period again with each event",
    }),
  ),
};
const retentionUpdate = t.Object(
  { propertyId, ...retention },
  { ...STRICT, ...atLeastOne(retention) },
);

const DATA_STREAM = child("dataStreams", "data stream");
const CUSTOM_DIMENSION = child("customDimensions", "custom dimension");
const CUSTOM_METRIC = child("customMetrics", "custom metric");
const KEY_EVENT = child("keyEvents", "key event");

const streamName = displayName("data stream", 255);
const defaultUri = t.String({
  pattern: "^https?://",
  description: "The website a web stream measures: https://www.example.com",
});
const dataStreamCreate = t.Object(
  {
    propertyId,
    type: stringEnum(
      [
        "WEB_DATA_STREAM",
        "ANDROID_APP_DATA_STREAM",
        "IOS_APP_DATA_STREAM",
      ] as const,
      { description: "What the stream measures; it cannot change" },
    ),
    displayName: t.Optional(streamName),
    defaultUri: t.Optional(defaultUri),
    packageName: t.Optional(
      t.String({
        minLength: 1,
        description:
          "An Android stream's app, by package name: com.example.app",
      }),
    ),
    bundleId: t.Optional(
      t.String({
        minLength: 1,
        description: "An iOS stream's app, by bundle ID: com.example.app",
      }),
    ),
  },
  STRICT,
);
const streamChanges = {
  displayName: t.Optional(streamName),
  defaultUri: t.Optional(defaultUri),
};
const dataStreamUpdate = t.Object(
  { name: DATA_STREAM.schema, ...streamChanges },
  { ...STRICT, ...atLeastOne(streamChanges) },
);

const parameterName = (what: string) =>
  t.String({
    pattern: "^[A-Za-z][A-Za-z0-9_]*$",
    description: `The ${what} it reads; it cannot change`,
  });
const dimensionChanges = {
  displayName: t.Optional(displayName("custom dimension", 82)),
  description: t.Optional(description),
  disallowAdsPersonalization: t.Optional(
    t.Boolean({
      description: "Keep a user-scoped dimension out of ads personalization",
    }),
  ),
};
const customDimensionCreate = t.Object(
  {
    propertyId,
    parameterName: parameterName(
      "event parameter, user property (USER scope) or item parameter (ITEM scope)",
    ),
    scope: stringEnum(["EVENT", "USER", "ITEM"] as const, {
      description: "What the dimension describes; it cannot change",
    }),
    ...dimensionChanges,
    displayName: displayName("custom dimension", 82),
  },
  STRICT,
);
const customDimensionUpdate = t.Object(
  { name: CUSTOM_DIMENSION.schema, ...dimensionChanges },
  { ...STRICT, ...atLeastOne(dimensionChanges) },
);

const UNITS = [
  "STANDARD",
  "CURRENCY",
  "FEET",
  "METERS",
  "KILOMETERS",
  "MILES",
  "MILLISECONDS",
  "SECONDS",
  "MINUTES",
  "HOURS",
] as const;
const metricChanges = {
  displayName: t.Optional(displayName("custom metric", 82)),
  description: t.Optional(description),
  measurementUnit: t.Optional(
    stringEnum(UNITS, { description: "The unit of the metric's value" }),
  ),
  restrictedMetricType: t.Optional(
    t.Array(stringEnum(["COST_DATA", "REVENUE_DATA"] as const), {
      description:
        "The restricted data a CURRENCY metric holds; required for one, and empty for any other unit",
    }),
  ),
};
const customMetricCreate = t.Object(
  {
    propertyId,
    parameterName: parameterName("event parameter"),
    ...metricChanges,
    displayName: displayName("custom metric", 82),
    measurementUnit: stringEnum(UNITS, {
      description: "The unit of the metric's value",
    }),
  },
  STRICT,
);
const customMetricUpdate = t.Object(
  { name: CUSTOM_METRIC.schema, ...metricChanges },
  { ...STRICT, ...atLeastOne(metricChanges) },
);

const countingMethod = stringEnum(
  ["ONCE_PER_EVENT", "ONCE_PER_SESSION"] as const,
  { description: "Count every such event, or one a session" },
);
const defaultValue = t.Object(
  {
    numericValue: t.Number({
      description: "The value of a key event that carries none",
    }),
    currencyCode: t.String({
      pattern: "^[A-Z]{3}$",
      description: "ISO 4217 currency of that value",
    }),
  },
  STRICT,
);
const keyEventCreate = t.Object(
  {
    propertyId,
    eventName: t.String({
      minLength: 1,
      description: "The event to count as a key event: purchase",
    }),
    countingMethod,
    defaultValue: t.Optional(defaultValue),
  },
  STRICT,
);
const keyEventChanges = {
  countingMethod: t.Optional(countingMethod),
  defaultValue: t.Optional(defaultValue),
};
const keyEventUpdate = t.Object(
  { name: KEY_EVENT.schema, ...keyEventChanges },
  { ...STRICT, ...atLeastOne(keyEventChanges) },
);

// ─── Plugin ─────────────────────────────────────────────────────

export default function googleAnalytics(rl: RunlinePluginAPI) {
  rl.setName(PLUGIN);
  rl.setVersion("0.1.0");
  rl.setCredential(googleCredential(PLUGIN, SCOPES));
  rl.setOAuth(googleOAuth(PLUGIN, SCOPES, "GOOGLE_ANALYTICS"));
  rl.setConnectionSchema(
    t.Object({
      ...googleConnection("GOOGLE_ANALYTICS"),
      propertyId: t.Optional(
        propertySchema(
          "The property calls are about, unless a call names another",
          { env: "GOOGLE_ANALYTICS_PROPERTY_ID" },
        ),
      ),
    }),
  );

  // ── Reports ────────────────────────────────────────

  rl.registerAction("report.run", {
    access: "read",
    description:
      "A report of a property's event data: metrics (activeUsers, sessions, eventCount, …) broken down by dimensions (date, country, pagePath, …) over date ranges, filtered and ordered. Each row answers { dimensions, metrics } by name, with values as strings; rowCount is how many rows there are, of which limit and offset answer a page. metadata flags sampling, thresholding and an (other) row.",
    inputSchema: reportRun,
    async execute(input, ctx) {
      const { propertyId, ...fields } = input;
      return table(
        await report(
          ctx,
          propertyName(ctx, propertyId),
          "runReport",
          request(fields),
        ),
      );
    },
  });

  rl.registerAction("report.runPivot", {
    access: "read",
    description:
      "A pivot report: the dimensions laid out by pivots, as a pivot table's rows and columns. Answers the API's shape: pivotHeaders name each pivot's dimension values, and each row its dimensionValues and metricValues by position.",
    inputSchema: reportRunPivot,
    async execute(input, ctx) {
      const { propertyId, ...fields } = input;
      return report(
        ctx,
        propertyName(ctx, propertyId),
        "runPivotReport",
        request(fields),
      );
    },
  });

  rl.registerAction("report.batchRun", {
    access: "read",
    description:
      "Up to 5 reports on one property in one request; answers reports, each as report.run answers it, in the order asked.",
    inputSchema: reportBatchRun,
    async execute(input, ctx) {
      const { propertyId, requests } = input;
      const answer = await report<{ reports?: ReportTable[] }>(
        ctx,
        propertyName(ctx, propertyId),
        "batchRunReports",
        { requests: requests.map(request) },
      );
      return {
        ...answer,
        reports: (answer.reports ?? []).map(table),
      };
    },
  });

  rl.registerAction("report.batchRunPivot", {
    access: "read",
    description:
      "Up to 5 pivot reports on one property in one request; answers pivotReports, each as report.runPivot answers it, in the order asked.",
    inputSchema: reportBatchRunPivot,
    async execute(input, ctx) {
      const { propertyId, requests } = input;
      return report(
        ctx,
        propertyName(ctx, propertyId),
        "batchRunPivotReports",
        { requests: requests.map(request) },
      );
    },
  });

  rl.registerAction("report.runRealtime", {
    access: "read",
    description:
      "A report of the events of the last 30 minutes, seconds after they arrive: activeUsers, eventCount, screenPageViews and the like, by the realtime dimensions (country, deviceCategory, unifiedScreenName, eventName, minutesAgo, …). Realtime takes fewer names than report.run. Rows answer as report.run's do.",
    inputSchema: reportRunRealtime,
    async execute(input, ctx) {
      const { propertyId, ...fields } = input;
      return table(
        await report(
          ctx,
          propertyName(ctx, propertyId),
          "runRealtimeReport",
          request(fields),
        ),
      );
    },
  });

  rl.registerAction("report.checkCompatibility", {
    access: "read",
    description:
      "Which dimensions and metrics can join a report.run request that has the ones given: each of the property's names as COMPATIBLE or INCOMPATIBLE with them. Fails when the ones given do not go together themselves.",
    inputSchema: reportCheckCompatibility,
    async execute(input, ctx) {
      const { propertyId, ...fields } = input;
      return report(
        ctx,
        propertyName(ctx, propertyId),
        "checkCompatibility",
        request(fields),
      );
    },
  });

  rl.registerAction("metadata.get", {
    access: "read",
    description:
      "The dimensions, metrics and saved comparisons a property's reports take: each one's apiName, UI name, category and description, the property's custom ones included (customEvent:name). Property 0 answers the names every property has.",
    inputSchema: propertyOnly,
    async execute(input, ctx) {
      const { propertyId } = input;
      return analytics(ctx, {
        api: "data",
        path: `${propertyName(ctx, propertyId)}/metadata`,
      });
    },
  });

  // ── Accounts ───────────────────────────────────────

  rl.registerAction("accountSummary.list", {
    access: "read",
    description:
      "Every account the login reaches, each with its properties: their resource names (properties/1234), display names and types. The way to find a property's ID.",
    inputSchema: page,
    async execute(input, ctx) {
      return read(ctx, "accountSummaries", input);
    },
  });

  rl.registerAction("account.list", {
    access: "read",
    description:
      "The accounts the login reaches, with their region and times; an account may have no property.",
    inputSchema: accountList,
    async execute(input, ctx) {
      return read(ctx, "accounts", input);
    },
  });

  rl.registerAction("account.get", {
    access: "read",
    description: "One account: its display name, region and times.",
    inputSchema: accountGet,
    async execute(input, ctx) {
      const { accountId } = input;
      return read(ctx, accountName(accountId));
    },
  });

  rl.registerAction("account.searchChangeHistory", {
    access: "read",
    description:
      "Who changed what in an account and its properties: each change's time, actor, and the resource before and after, a page at a time. A page may come back short or empty while nextPageToken says more follow.",
    inputSchema: changeHistory,
    async execute(input, ctx) {
      const { accountId, propertyId, ...filter } = input;
      return analytics(ctx, {
        api: "admin",
        method: "POST",
        path: `${accountName(accountId)}:searchChangeHistoryEvents`,
        body: {
          ...filter,
          property:
            propertyId === undefined
              ? undefined
              : propertyName(ctx, propertyId),
        },
      });
    },
  });

  // ── Properties ─────────────────────────────────────

  rl.registerAction("property.list", {
    access: "read",
    description:
      "The properties under an account or a property, or linked to a Firebase project, a page at a time.",
    inputSchema: propertyList,
    async execute(input, ctx) {
      return read(ctx, "properties", input);
    },
  });

  rl.registerAction("property.get", {
    access: "read",
    description:
      "One property: its display name, time zone, currency, industry, type, service level and account.",
    inputSchema: propertyOnly,
    async execute(input, ctx) {
      const { propertyId } = input;
      return read(ctx, propertyName(ctx, propertyId));
    },
  });

  rl.registerAction("property.create", {
    access: "write",
    description:
      "Create a Google Analytics 4 property in an account. Its data streams are added with dataStream.create.",
    inputSchema: propertyCreate,
    async execute(input, ctx) {
      const { accountId, ...settings } = input;
      return change(ctx, {
        method: "POST",
        path: "properties",
        body: { parent: accountName(accountId), ...settings },
      });
    },
  });

  rl.registerAction("property.update", {
    access: "write",
    description:
      "Change a property's display name, time zone, currency or industry.",
    inputSchema: propertyUpdate,
    async execute(input, ctx) {
      const { propertyId, ...changes } = input;
      return patch(ctx, propertyName(ctx, propertyId), {
        display_name: changes.displayName,
        time_zone: changes.timeZone,
        currency_code: changes.currencyCode,
        industry_category: changes.industryCategory,
      });
    },
  });

  rl.registerAction("property.delete", {
    access: "write",
    description:
      "Move a property to the trash, and answer it with its expireTime: Google deletes it and everything under it for good then, unless it is restored in the Analytics UI first. The API cannot restore it.",
    inputSchema: propertyDelete,
    async execute(input, ctx) {
      const { propertyId } = input;
      return change(ctx, {
        method: "DELETE",
        path: propertyName(ctx, propertyId),
      });
    },
  });

  rl.registerAction("property.getDataRetention", {
    access: "read",
    description: "How long a property keeps event and user data.",
    inputSchema: propertyOnly,
    async execute(input, ctx) {
      const { propertyId } = input;
      return read(
        ctx,
        `${propertyName(ctx, propertyId)}/dataRetentionSettings`,
      );
    },
  });

  rl.registerAction("property.updateDataRetention", {
    access: "write",
    description: "Change how long a property keeps event and user data.",
    inputSchema: retentionUpdate,
    async execute(input, ctx) {
      const { propertyId, ...changes } = input;
      return patch(
        ctx,
        `${propertyName(ctx, propertyId)}/dataRetentionSettings`,
        {
          event_data_retention: changes.eventDataRetention,
          user_data_retention: changes.userDataRetention,
          reset_user_data_on_new_activity: changes.resetUserDataOnNewActivity,
        },
      );
    },
  });

  // ── A property's resources ─────────────────────────

  for (const [resource, kind, about] of [
    [
      "dataStream",
      DATA_STREAM,
      "data streams: the websites and apps it measures, a web stream with its measurementId (G-…)",
    ],
    [
      "customDimension",
      CUSTOM_DIMENSION,
      "custom dimensions: each one's parameter, scope and display name",
    ],
    [
      "customMetric",
      CUSTOM_METRIC,
      "custom metrics: each one's parameter, unit and display name",
    ],
    [
      "keyEvent",
      KEY_EVENT,
      "key events: the events it counts as key events, and how",
    ],
  ] as const) {
    rl.registerAction(`${resource}.list`, {
      access: "read",
      description: `A property's ${about}. A page at a time.`,
      inputSchema: propertyPage,
      execute: listOf(kind.collection),
    });
    rl.registerAction(`${resource}.get`, {
      access: "read",
      description: `One of a property's ${kind.collection}, by its resource name.`,
      inputSchema: kind.named,
      async execute(input, ctx) {
        return read(ctx, kind.path(input.name));
      },
    });
  }

  for (const [resource, collection] of [
    ["googleAdsLink", "googleAdsLinks"],
    ["firebaseLink", "firebaseLinks"],
  ] as const)
    rl.registerAction(`${resource}.list`, {
      access: "read",
      description: `A property's ${collection}: what it is linked to, and since when.`,
      inputSchema: propertyPage,
      execute: listOf(collection),
    });

  // ── Data streams ───────────────────────────────────

  rl.registerAction("dataStream.create", {
    access: "write",
    description:
      "Add a data stream to a property: a website (displayName and defaultUri), an Android app (packageName) or an iOS app (bundleId). A web stream answers the measurementId its tag sends to.",
    inputSchema: dataStreamCreate,
    async execute(input, ctx) {
      const { propertyId, defaultUri, packageName, bundleId, ...stream } =
        input;
      return change(ctx, {
        method: "POST",
        path: `${propertyName(ctx, propertyId)}/dataStreams`,
        body: {
          ...stream,
          webStreamData: defaultUri === undefined ? undefined : { defaultUri },
          androidAppStreamData:
            packageName === undefined ? undefined : { packageName },
          iosAppStreamData: bundleId === undefined ? undefined : { bundleId },
        },
      });
    },
  });

  rl.registerAction("dataStream.update", {
    access: "write",
    description: "Rename a data stream, or change the website a web one names.",
    inputSchema: dataStreamUpdate,
    async execute(input, ctx) {
      const { name, ...changes } = input;
      return patch(ctx, DATA_STREAM.path(name), {
        display_name: changes.displayName,
        "web_stream_data.default_uri": changes.defaultUri,
      });
    },
  });

  // ── Custom dimensions and metrics ──────────────────

  rl.registerAction("customDimension.create", {
    access: "write",
    description:
      "Register an event parameter, user property or item parameter as a custom dimension, which reports name as customEvent:name, customUser:name or customItem:name. Google's terms forbid using one to collect data on individual users, user IDs included.",
    inputSchema: customDimensionCreate,
    async execute(input, ctx) {
      const { propertyId, ...definition } = input;
      return change(ctx, {
        method: "POST",
        path: `${propertyName(ctx, propertyId)}/customDimensions`,
        body: definition,
      });
    },
  });

  rl.registerAction("customDimension.update", {
    access: "write",
    description: "Change a custom dimension's display name or description.",
    inputSchema: customDimensionUpdate,
    async execute(input, ctx) {
      const { name, ...changes } = input;
      return patch(ctx, CUSTOM_DIMENSION.path(name), {
        display_name: changes.displayName,
        description: changes.description,
        disallow_ads_personalization: changes.disallowAdsPersonalization,
      });
    },
  });

  rl.registerAction("customMetric.create", {
    access: "write",
    description:
      "Register an event parameter as a custom metric, which reports name as customEvent:name.",
    inputSchema: customMetricCreate,
    async execute(input, ctx) {
      const { propertyId, ...definition } = input;
      return change(ctx, {
        method: "POST",
        path: `${propertyName(ctx, propertyId)}/customMetrics`,
        body: { ...definition, scope: "EVENT" },
      });
    },
  });

  rl.registerAction("customMetric.update", {
    access: "write",
    description: "Change a custom metric's display name, description or unit.",
    inputSchema: customMetricUpdate,
    async execute(input, ctx) {
      const { name, ...changes } = input;
      return patch(ctx, CUSTOM_METRIC.path(name), {
        display_name: changes.displayName,
        description: changes.description,
        measurement_unit: changes.measurementUnit,
        restricted_metric_type: changes.restrictedMetricType,
      });
    },
  });

  for (const [resource, kind] of [
    ["customDimension", CUSTOM_DIMENSION],
    ["customMetric", CUSTOM_METRIC],
  ] as const)
    rl.registerAction(`${resource}.archive`, {
      access: "write",
      description: `Archive one of a property's ${kind.collection}, by its resource name.`,
      inputSchema: kind.named,
      async execute(input, ctx) {
        return change(ctx, {
          method: "POST",
          path: `${kind.path(input.name)}:archive`,
          body: {},
        });
      },
    });

  // ── Key events ─────────────────────────────────────

  rl.registerAction("keyEvent.create", {
    access: "write",
    description:
      "Count an event as a key event, every time it occurs or once a session. Key events replace the API's conversion events.",
    inputSchema: keyEventCreate,
    async execute(input, ctx) {
      const { propertyId, ...keyEvent } = input;
      return change(ctx, {
        method: "POST",
        path: `${propertyName(ctx, propertyId)}/keyEvents`,
        body: keyEvent,
      });
    },
  });

  rl.registerAction("keyEvent.update", {
    access: "write",
    description: "Change how a key event is counted, or its default value.",
    inputSchema: keyEventUpdate,
    async execute(input, ctx) {
      const { name, ...changes } = input;
      return patch(ctx, KEY_EVENT.path(name), {
        counting_method: changes.countingMethod,
        default_value: changes.defaultValue,
      });
    },
  });

  for (const [resource, kind, about] of [
    ["dataStream", DATA_STREAM, "Delete a data stream from its property."],
    [
      "keyEvent",
      KEY_EVENT,
      "Delete a key event, so its event is no longer counted as one. Only a key event answered as deletable can go.",
    ],
  ] as const)
    rl.registerAction(`${resource}.delete`, {
      access: "write",
      description: about,
      inputSchema: kind.named,
      async execute(input, ctx) {
        return change(ctx, {
          method: "DELETE",
          path: kind.path(input.name),
        });
      },
    });
}
