import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { unansweredChange } from "../../../runline-plugins/_shared/changes.js";
import { googleFailure } from "../../../runline-plugins/_shared/googleAuth.js";
import { maskedFields } from "../../../runline-plugins/_shared/googleFieldMask.js";
import googleAnalytics from "../../../runline-plugins/googleAnalytics/src/index.js";
import { table } from "../../../runline-plugins/googleAnalytics/src/shared.js";
import { createPluginAPI } from "../plugin/api.js";
import { validateTypedInput } from "../plugin/schema.js";
import type { ActionContext, TypedInputSchema } from "../plugin/types.js";
import { getAction, stubFetch } from "./helpers/plugin.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const { api, resolve } = createPluginAPI("googleAnalytics");
googleAnalytics(api);
const plugin = resolve();

/** A delegated login holding a current access token, so no renewal runs. */
function context(config: Record<string, unknown> = {}): ActionContext {
  return {
    connection: {
      name: "analytics",
      plugin: "googleAnalytics",
      config: {
        clientId: "client",
        clientSecret: "secret",
        refreshToken: "refresh",
        accessToken: "access",
        accessTokenExpiresAt: Date.now() + 3_600_000,
        ...config,
      },
    },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
}

type Call = { url: URL; init: RequestInit; body: Record<string, unknown> };

/** Answers each request with the next response, the last one repeating. */
function mock(responses: Array<() => Response>): Call[] {
  const calls: Call[] = [];
  stubFetch(async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body;
    calls.push({
      url: new URL(String(url)),
      init: init ?? {},
      body:
        body === undefined || body === null
          ? {}
          : JSON.parse(Buffer.from(body as Uint8Array).toString()),
    });
    return responses[Math.min(calls.length, responses.length) - 1]();
  });
  return calls;
}
const run = (name: string, input: unknown, ctx = context()) =>
  getAction(plugin, name).execute(input, ctx);
/** The engine's verdict on an input, normalization included. */
const valid = (name: string, input: unknown) =>
  validateTypedInput(
    getAction(plugin, name).inputSchema as TypedInputSchema,
    input,
  ).ok;

const DATA = "https://analyticsdata.googleapis.com/v1beta/";
const ADMIN = "https://analyticsadmin.googleapis.com/v1beta/";
const week = [{ startDate: "7daysAgo", endDate: "yesterday" }];
const DIMENSION = "properties/1234/customDimensions/5678";

describe("googleAnalytics inputs", () => {
  it("names a property by its ID or its resource name, and nothing else", () => {
    const report = { dateRanges: week, metrics: ["activeUsers"] };
    assert.ok(valid("report.run", report));
    assert.ok(valid("report.run", { ...report, propertyId: "1234" }));
    assert.ok(
      valid("report.run", { ...report, propertyId: "properties/1234" }),
    );
    for (const propertyId of ["", "G-1A2BCD345E", "accounts/1", "1234/x"])
      assert.equal(valid("report.run", { ...report, propertyId }), false);
    assert.equal(valid("report.run", { ...report, extra: 1 }), false);
  });

  it("takes date ranges or a cohort spec, never both and never neither", () => {
    const cohortSpec = { cohorts: [], cohortsRange: {} };
    assert.ok(valid("report.run", { dateRanges: week }));
    assert.ok(valid("report.run", { cohortSpec }));
    assert.equal(valid("report.run", {}), false);
    assert.equal(valid("report.run", { dateRanges: week, cohortSpec }), false);
    assert.equal(
      valid("report.batchRun", { requests: [{ metrics: ["sessions"] }] }),
      false,
    );
  });

  it("takes a day as a date or one of the API's relative names", () => {
    const range = (startDate: string) => ({
      dateRanges: [{ startDate, endDate: "today" }],
    });
    for (const day of ["2026-11-01", "today", "yesterday", "30daysAgo"])
      assert.ok(valid("report.run", range(day)), day);
    for (const day of ["last week", "11/01/2026", "daysAgo"])
      assert.equal(valid("report.run", range(day)), false, day);
  });

  it("holds a report to the API's counts of dimensions, metrics, ranges and reports", () => {
    const names = (count: number) =>
      Array.from({ length: count }, (_, at) => `n${at}`);
    assert.ok(
      valid("report.run", {
        dateRanges: week,
        dimensions: names(9),
        metrics: names(10),
      }),
    );
    assert.equal(
      valid("report.run", { dateRanges: week, dimensions: names(10) }),
      false,
    );
    assert.equal(
      valid("report.run", { dateRanges: week, metrics: names(11) }),
      false,
    );
    assert.equal(
      valid("report.run", {
        dateRanges: [...week, ...week, ...week, ...week, ...week],
      }),
      false,
    );
    assert.equal(
      valid("report.batchRun", {
        requests: Array.from({ length: 6 }, () => ({ dateRanges: week })),
      }),
      false,
    );
    assert.equal(
      valid("report.run", { dateRanges: week, limit: 250001 }),
      false,
    );
  });

  it("requires a pivot report's metrics and pivots, each pivot with its limit", () => {
    const pivot = { fieldNames: ["country"], limit: 10 };
    const report = {
      dateRanges: week,
      dimensions: ["country"],
      metrics: ["sessions"],
      pivots: [pivot],
    };
    assert.ok(valid("report.runPivot", report));
    assert.equal(valid("report.runPivot", { ...report, metrics: [] }), false);
    assert.equal(valid("report.runPivot", { ...report, pivots: [] }), false);
    assert.equal(
      valid("report.runPivot", {
        ...report,
        pivots: [{ fieldNames: ["country"] }],
      }),
      false,
    );
    // A pivot orders its own rows; the report has no order of its own.
    assert.equal(
      valid("report.runPivot", { ...report, orderBys: [{}] }),
      false,
    );
  });

  it("names a property's resource as its list answers it", () => {
    assert.ok(valid("customDimension.get", { name: DIMENSION }));
    for (const name of [
      "5678",
      "properties/1234/customMetrics/5678",
      "properties/1234/customDimensions/5678/x",
      "accounts/1",
    ])
      assert.equal(valid("customDimension.get", { name }), false, name);
  });

  it("requires a change, and a named property to trash", () => {
    assert.equal(valid("property.update", { propertyId: "1234" }), false);
    assert.ok(valid("property.update", { displayName: "Shop" }));
    assert.equal(valid("customDimension.update", { name: DIMENSION }), false);
    assert.equal(valid("property.updateDataRetention", {}), false);
    assert.equal(
      valid("property.updateDataRetention", {
        eventDataRetention: "SIX_MONTHS",
      }),
      false,
    );
    assert.equal(valid("property.delete", {}), false);
    assert.ok(valid("property.delete", { propertyId: "1234" }));
  });
});

describe("googleAnalytics credential", () => {
  it("signs the Data and Admin APIs only, on the shared Google grant", () => {
    const selection = plugin.credential?.({
      authMethod: "delegated",
      clientId: "client",
    });
    const method = selection?.type.methods.delegated;
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(method?.targets ?? {}).map(([name, target]) => [
          name,
          target.baseUrl,
        ]),
      ),
      { analyticsData: DATA, analyticsAdmin: ADMIN },
    );
    assert.equal(method?.probe?.target, "analyticsAdmin");
    assert.equal(method?.probe?.path, "accountSummaries?pageSize=1");
    assert.equal(plugin.oauth?.grant, "google");
    assert.deepEqual(plugin.oauth?.scopes, [
      "https://www.googleapis.com/auth/analytics.readonly",
      "https://www.googleapis.com/auth/analytics.edit",
    ]);
  });
});

describe("googleAnalytics reports", () => {
  const answer = {
    dimensionHeaders: [{ name: "country" }, { name: "date" }],
    metricHeaders: [
      { name: "activeUsers", type: "TYPE_INTEGER" },
      { name: "customEvent:score", type: "TYPE_FLOAT" },
    ],
    rows: [
      {
        dimensionValues: [{ value: "Israel" }, { value: "20261117" }],
        metricValues: [{ value: "12" }, { value: "3.5" }],
      },
    ],
    totals: [
      {
        dimensionValues: [{ value: "RESERVED_TOTAL" }, { value: "" }],
        metricValues: [{ value: "12" }, { value: "3.5" }],
      },
    ],
    rowCount: 1,
    metadata: { currencyCode: "USD", timeZone: "Asia/Jerusalem" },
    kind: "analyticsData#runReport",
  };
  const row = {
    dimensions: { country: "Israel", date: "20261117" },
    metrics: { activeUsers: "12", "customEvent:score": "3.5" },
  };

  it("runs a report on the call's property, naming dimensions and metrics as objects", async () => {
    const calls = mock([() => Response.json(answer)]);
    const result = await run("report.run", {
      propertyId: "properties/1234",
      dateRanges: week,
      dimensions: ["country", "date"],
      metrics: [
        "activeUsers",
        { name: "perUser", expression: "eventCount/totalUsers" },
      ],
      dimensionFilter: {
        filter: { fieldName: "country", stringFilter: { value: "Israel" } },
      },
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      metricAggregations: ["TOTAL"],
      limit: 100,
      offset: 200,
    });
    assert.equal(calls[0].url.href, `${DATA}properties/1234:runReport`);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(
      new Headers(calls[0].init.headers).get("authorization"),
      "Bearer access",
    );
    assert.deepEqual(calls[0].body, {
      dateRanges: week,
      dimensions: [{ name: "country" }, { name: "date" }],
      metrics: [
        { name: "activeUsers" },
        { name: "perUser", expression: "eventCount/totalUsers" },
      ],
      dimensionFilter: {
        filter: { fieldName: "country", stringFilter: { value: "Israel" } },
      },
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      metricAggregations: ["TOTAL"],
      limit: 100,
      offset: 200,
    });
    assert.deepEqual(result, {
      ...answer,
      rows: [row],
      totals: [
        {
          dimensions: { country: "RESERVED_TOTAL", date: "" },
          metrics: row.metrics,
        },
      ],
    });
  });

  it("reports on the connection's property when the call names none", async () => {
    const calls = mock([() => Response.json({ rowCount: 0 })]);
    const ctx = context({ propertyId: "777" });
    assert.deepEqual(await run("report.run", { dateRanges: week }, ctx), {
      rowCount: 0,
    });
    await run("report.run", { dateRanges: week, propertyId: "1234" }, ctx);
    assert.equal(calls[0].url.href, `${DATA}properties/777:runReport`);
    assert.equal(calls[1].url.href, `${DATA}properties/1234:runReport`);
  });

  it("refuses a report with no property, or a malformed one on the connection, before any request", async () => {
    const calls = mock([() => Response.json({})]);
    await assert.rejects(run("report.run", { dateRanges: week }), {
      message:
        "googleAnalytics: propertyId is required: pass it, or set it on the connection (accountSummary.list finds it)",
    });
    await assert.rejects(
      run("report.run", { dateRanges: week }, context({ propertyId: "G-1" })),
      {
        message:
          "googleAnalytics: propertyId must be a numeric property ID or properties/<id>",
      },
    );
    assert.equal(calls.length, 0);
  });

  it("keys a row's values by column, whatever the column is called", () => {
    assert.deepEqual(
      table({
        dimensionHeaders: [{ name: "customEvent:plan" }],
        metricHeaders: [{ name: "customEvent:plan" }],
        rows: [
          {
            dimensionValues: [{ value: "pro" }],
            metricValues: [{ value: "4" }],
          },
          // A report of metrics alone answers rows without dimensions.
          { metricValues: [{ value: "9" }] },
        ],
      }).rows,
      [
        {
          dimensions: { "customEvent:plan": "pro" },
          metrics: { "customEvent:plan": "4" },
        },
        {
          dimensions: { "customEvent:plan": undefined },
          metrics: { "customEvent:plan": "9" },
        },
      ],
    );
    assert.deepEqual(table({ rowCount: 0 }), { rowCount: 0 });
  });

  it("runs several reports at once, each answered as its own", async () => {
    const calls = mock([
      () =>
        Response.json({
          reports: [answer, { rowCount: 0 }],
          kind: "analyticsData#batchRunReports",
        }),
    ]);
    const result = (await run("report.batchRun", {
      propertyId: "1234",
      requests: [
        { dateRanges: week, dimensions: ["country", "date"] },
        { dateRanges: week, metrics: ["sessions"] },
      ],
    })) as { reports: Array<{ rows?: unknown[] }> };
    assert.equal(calls[0].url.href, `${DATA}properties/1234:batchRunReports`);
    assert.deepEqual(calls[0].body, {
      requests: [
        {
          dateRanges: week,
          dimensions: [{ name: "country" }, { name: "date" }],
        },
        { dateRanges: week, metrics: [{ name: "sessions" }] },
      ],
    });
    assert.deepEqual(result.reports[0].rows, [row]);
    assert.deepEqual(result.reports[1], { rowCount: 0 });
  });

  it("answers a pivot report in the API's shape", async () => {
    const pivotAnswer = {
      pivotHeaders: [{ pivotDimensionHeaders: [], rowCount: 1 }],
      rows: answer.rows,
    };
    const calls = mock([
      () => Response.json(pivotAnswer),
      () => Response.json({ pivotReports: [pivotAnswer] }),
    ]);
    const report = {
      dateRanges: week,
      dimensions: ["country"],
      metrics: ["sessions"],
      pivots: [{ fieldNames: ["country"], limit: 5 }],
    };
    assert.deepEqual(
      await run("report.runPivot", { propertyId: "1234", ...report }),
      pivotAnswer,
    );
    assert.equal(calls[0].url.href, `${DATA}properties/1234:runPivotReport`);
    assert.deepEqual(calls[0].body, {
      ...report,
      dimensions: [{ name: "country" }],
      metrics: [{ name: "sessions" }],
    });
    assert.deepEqual(
      await run("report.batchRunPivot", {
        propertyId: "1234",
        requests: [report],
      }),
      { pivotReports: [pivotAnswer] },
    );
    assert.equal(
      calls[1].url.href,
      `${DATA}properties/1234:batchRunPivotReports`,
    );
  });

  it("runs realtime, compatibility and metadata calls on the Data API", async () => {
    const calls = mock([() => Response.json({})]);
    await run("report.runRealtime", {
      propertyId: "1234",
      dimensions: ["country"],
      metrics: ["activeUsers"],
      minuteRanges: [{ startMinutesAgo: 9, endMinutesAgo: 0 }],
    });
    await run("report.checkCompatibility", {
      propertyId: "1234",
      metrics: ["activeUsers"],
      compatibilityFilter: "COMPATIBLE",
    });
    await run("metadata.get", { propertyId: "0" });
    assert.equal(calls[0].url.href, `${DATA}properties/1234:runRealtimeReport`);
    assert.deepEqual(calls[0].body, {
      dimensions: [{ name: "country" }],
      metrics: [{ name: "activeUsers" }],
      minuteRanges: [{ startMinutesAgo: 9, endMinutesAgo: 0 }],
    });
    assert.equal(
      calls[1].url.href,
      `${DATA}properties/1234:checkCompatibility`,
    );
    assert.deepEqual(calls[1].body, {
      metrics: [{ name: "activeUsers" }],
      compatibilityFilter: "COMPATIBLE",
    });
    assert.equal(calls[2].url.href, `${DATA}properties/0/metadata`);
    assert.equal(calls[2].init.method, "GET");
  });
});

describe("googleAnalytics configuration", () => {
  it("lists accounts and properties a page at a time, as the API answers them", async () => {
    const summaries = {
      accountSummaries: [{ account: "accounts/1", propertySummaries: [] }],
      nextPageToken: "p2",
    };
    const calls = mock([() => Response.json(summaries)]);
    assert.deepEqual(
      await run("accountSummary.list", { pageSize: 10, pageToken: "p1" }),
      summaries,
    );
    await run("account.get", { accountId: "accounts/1" });
    await run("property.list", {
      filter: "ancestor:accounts/1",
      showDeleted: true,
    });
    await run("customMetric.list", { propertyId: "1234", pageSize: 5 });
    await run("firebaseLink.list", {}, context({ propertyId: "777" }));
    assert.equal(
      calls[0].url.href,
      `${ADMIN}accountSummaries?pageSize=10&pageToken=p1`,
    );
    assert.equal(calls[1].url.href, `${ADMIN}accounts/1`);
    assert.equal(
      calls[2].url.href,
      `${ADMIN}properties?filter=ancestor%3Aaccounts%2F1&showDeleted=true`,
    );
    assert.equal(
      calls[3].url.href,
      `${ADMIN}properties/1234/customMetrics?pageSize=5`,
    );
    assert.equal(calls[4].url.href, `${ADMIN}properties/777/firebaseLinks`);
    for (const call of calls) assert.equal(call.init.method, "GET");
  });

  it("gets and removes a property's resource by its resource name", async () => {
    const calls = mock([() => Response.json({})]);
    await run("customDimension.get", { name: DIMENSION });
    await run("customDimension.archive", { name: DIMENSION });
    await run("keyEvent.delete", { name: "properties/1234/keyEvents/9" });
    assert.equal(calls[0].url.href, `${ADMIN}${DIMENSION}`);
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[1].url.href, `${ADMIN}${DIMENSION}:archive`);
    assert.equal(calls[1].init.method, "POST");
    assert.deepEqual(calls[1].body, {});
    assert.equal(calls[2].url.href, `${ADMIN}properties/1234/keyEvents/9`);
    assert.equal(calls[2].init.method, "DELETE");
  });

  it("refuses a resource name of another shape, and encodes an ID within its segment", async () => {
    const calls = mock([() => Response.json({})]);
    for (const name of [
      "properties/1234/customMetrics/5678",
      "accounts/1",
      "properties/1234/customDimensions/5678/x",
      "properties/../customDimensions/5678",
    ])
      await assert.rejects(run("customDimension.get", { name }), {
        code: "request_not_allowed",
      });
    assert.equal(calls.length, 0);
    await run("customDimension.get", {
      name: "properties/1234/customDimensions/a?b",
    });
    assert.equal(
      calls[0].url.href,
      `${ADMIN}properties/1234/customDimensions/a%3Fb`,
    );
  });

  it("creates under the account or the property the call names", async () => {
    const calls = mock([() => Response.json({})]);
    await run("property.create", {
      accountId: "1",
      displayName: "Shop",
      timeZone: "Asia/Jerusalem",
      currencyCode: "ILS",
    });
    await run("dataStream.create", {
      propertyId: "1234",
      type: "WEB_DATA_STREAM",
      displayName: "Site",
      defaultUri: "https://www.example.com",
    });
    await run("customMetric.create", {
      propertyId: "1234",
      parameterName: "score",
      displayName: "Score",
      measurementUnit: "STANDARD",
    });
    await run("keyEvent.create", {
      propertyId: "1234",
      eventName: "purchase",
      countingMethod: "ONCE_PER_EVENT",
      defaultValue: { numericValue: 5, currencyCode: "USD" },
    });
    assert.equal(calls[0].url.href, `${ADMIN}properties`);
    assert.deepEqual(calls[0].body, {
      parent: "accounts/1",
      displayName: "Shop",
      timeZone: "Asia/Jerusalem",
      currencyCode: "ILS",
    });
    assert.equal(calls[1].url.href, `${ADMIN}properties/1234/dataStreams`);
    assert.deepEqual(calls[1].body, {
      type: "WEB_DATA_STREAM",
      displayName: "Site",
      webStreamData: { defaultUri: "https://www.example.com" },
    });
    assert.deepEqual(calls[2].body, {
      parameterName: "score",
      displayName: "Score",
      measurementUnit: "STANDARD",
      scope: "EVENT",
    });
    assert.equal(calls[3].url.href, `${ADMIN}properties/1234/keyEvents`);
    assert.deepEqual(calls[3].body, {
      eventName: "purchase",
      countingMethod: "ONCE_PER_EVENT",
      defaultValue: { numericValue: 5, currencyCode: "USD" },
    });
    for (const call of calls) assert.equal(call.init.method, "POST");
  });

  it("updates only the fields given, and names them in the mask", async () => {
    const calls = mock([() => Response.json({})]);
    await run("property.update", {
      propertyId: "1234",
      displayName: "Shop",
      timeZone: "UTC",
    });
    await run("dataStream.update", {
      name: "properties/1234/dataStreams/7",
      defaultUri: "https://shop.example.com",
    });
    await run("property.updateDataRetention", {
      propertyId: "1234",
      eventDataRetention: "FOURTEEN_MONTHS",
      resetUserDataOnNewActivity: false,
    });
    assert.equal(
      calls[0].url.href,
      `${ADMIN}properties/1234?updateMask=display_name%2Ctime_zone`,
    );
    assert.equal(calls[0].init.method, "PATCH");
    assert.deepEqual(calls[0].body, { displayName: "Shop", timeZone: "UTC" });
    assert.equal(
      calls[1].url.href,
      `${ADMIN}properties/1234/dataStreams/7?updateMask=web_stream_data.default_uri`,
    );
    assert.deepEqual(calls[1].body, {
      webStreamData: { defaultUri: "https://shop.example.com" },
    });
    assert.equal(
      calls[2].url.href,
      `${ADMIN}properties/1234/dataRetentionSettings?updateMask=event_data_retention%2Creset_user_data_on_new_activity`,
    );
    assert.deepEqual(calls[2].body, {
      eventDataRetention: "FOURTEEN_MONTHS",
      resetUserDataOnNewActivity: false,
    });
  });

  it("searches an account's change history, within a property when asked", async () => {
    const calls = mock([() => Response.json({ changeHistoryEvents: [] })]);
    await run("account.searchChangeHistory", {
      accountId: "1",
      propertyId: "1234",
      action: ["DELETED"],
      earliestChangeTime: "2026-11-01T00:00:00Z",
      pageSize: 20,
    });
    assert.equal(
      calls[0].url.href,
      `${ADMIN}accounts/1:searchChangeHistoryEvents`,
    );
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(calls[0].body, {
      property: "properties/1234",
      action: ["DELETED"],
      earliestChangeTime: "2026-11-01T00:00:00Z",
      pageSize: 20,
    });
  });
});

describe("googleAnalytics failures", () => {
  const failure = (status: number, error: Record<string, unknown>) => () =>
    Response.json({ error: { code: status, ...error } }, { status });

  it("reads Google's status, reason and faulted fields, never its messages", () => {
    assert.deepEqual(
      googleFailure({
        error: {
          status: "INVALID_ARGUMENT",
          message: "secret-ish text",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.BadRequest",
              fieldViolations: [
                { field: "display_name", description: "too long" },
              ],
            },
          ],
        },
      }),
      { code: "INVALID_ARGUMENT", param: ["display_name"] },
    );
    assert.deepEqual(
      googleFailure({
        error: {
          status: "PERMISSION_DENIED",
          details: [{ reason: "SERVICE_DISABLED", domain: "googleapis.com" }],
        },
      }),
      { code: "PERMISSION_DENIED.SERVICE_DISABLED", param: [] },
    );
    // An older API names its reason in `errors`, and may name no status.
    assert.deepEqual(
      googleFailure({ error: { errors: [{ reason: "notFound" }] } }),
      { code: "notFound", param: [] },
    );
    assert.deepEqual(googleFailure(null), { code: undefined, param: [] });
  });

  it("reports the status and Google's code, with a hint for the ones worth one", async () => {
    mock([
      failure(400, {
        status: "INVALID_ARGUMENT",
        message: "Field usrs is not a valid metric.",
      }),
      failure(403, {
        status: "PERMISSION_DENIED",
        details: [{ reason: "SERVICE_DISABLED" }],
      }),
      failure(404, { status: "NOT_FOUND" }),
    ]);
    const report = { propertyId: "1234", dateRanges: week, metrics: ["usrs"] };
    await assert.rejects(run("report.run", report), {
      message:
        "googleAnalytics: request failed (HTTP 400 INVALID_ARGUMENT): metadata.get lists the property's dimension and metric names, and report.checkCompatibility says which go together",
      status: 400,
    });
    await assert.rejects(run("report.run", report), {
      message:
        "googleAnalytics: request failed (HTTP 403 PERMISSION_DENIED.SERVICE_DISABLED): the Cloud project has not enabled this Analytics API",
      status: 403,
    });
    await assert.rejects(run("property.get", { propertyId: "1234" }), {
      message: "googleAnalytics: request failed (HTTP 404 NOT_FOUND)",
      status: 404,
    });
  });

  it("keeps the report hint to reports, and names the field a change faults", async () => {
    mock([
      failure(400, {
        status: "INVALID_ARGUMENT",
        details: [{ fieldViolations: [{ field: "time_zone" }] }],
      }),
    ]);
    await assert.rejects(
      run("property.update", { propertyId: "1234", timeZone: "Mars" }),
      {
        message:
          "googleAnalytics: request failed (HTTP 400 INVALID_ARGUMENT, param: time_zone)",
        status: 400,
      },
    );
  });

  it("says a change's outcome is unknown after a 5xx or no answer, and a read's is not", async () => {
    mock([failure(503, { status: "UNAVAILABLE" })]);
    await assert.rejects(
      run("keyEvent.delete", { name: "properties/1234/keyEvents/9" }),
      {
        message:
          "googleAnalytics: request failed (HTTP 503 UNAVAILABLE). The change may have been applied: check before sending it again.",
        status: 503,
      },
    );
    await assert.rejects(
      run("report.run", { propertyId: "1234", dateRanges: week }),
      { message: "googleAnalytics: request failed (HTTP 503 UNAVAILABLE)" },
    );
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(
      run("property.update", { propertyId: "1234", displayName: "Shop" }),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "transport_failed");
        assert.match(error.message, /The change may have been applied/);
        return true;
      },
    );
    await assert.rejects(
      run("account.searchChangeHistory", { accountId: "1" }),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "transport_failed");
        assert.doesNotMatch(error.message, /may have been applied/);
        return true;
      },
    );
  });
});

describe("shared Google helpers", () => {
  it("builds a camelCase body and a snake_case mask from the fields given", () => {
    assert.deepEqual(
      maskedFields({
        display_name: "Shop",
        time_zone: undefined,
        "web_stream_data.default_uri": "https://a.example",
        "web_stream_data.other_field": false,
      }),
      {
        body: {
          displayName: "Shop",
          webStreamData: { defaultUri: "https://a.example", otherField: false },
        },
        updateMask:
          "display_name,web_stream_data.default_uri,web_stream_data.other_field",
      },
    );
    assert.deepEqual(maskedFields({}), { body: {}, updateMask: "" });
  });

  it("leaves an error that is not a lost answer as it is", () => {
    const refused = Object.assign(new Error("no"), { code: "invalid_input" });
    assert.equal(unansweredChange(refused), refused);
  });
});
