import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import googleAds from "../../../codemode-plugins/googleAds/src/index.js";
import { adsFailure } from "../../../codemode-plugins/googleAds/src/shared.js";
import { createPluginAPI } from "../plugin/api.js";
import { validateTypedInput } from "../plugin/schema.js";
import type { ActionContext, TypedInputSchema } from "../plugin/types.js";
import { getAction, stubFetch } from "./helpers/plugin.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const { api, resolve } = createPluginAPI("googleAds");
googleAds(api);
const plugin = resolve();

/** A delegated login holding a current access token, so no renewal runs. */
function context(config: Record<string, unknown> = {}): ActionContext {
  return {
    connection: {
      name: "ads",
      plugin: "googleAds",
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
const header = (call: Call, name: string) =>
  new Headers(call.init.headers).get(name);
const run = (name: string, input: unknown, ctx = context()) =>
  getAction(plugin, name).execute(input, ctx);
/** The engine's verdict on an input, normalization included. */
const valid = (name: string, input: unknown) =>
  validateTypedInput(
    getAction(plugin, name).inputSchema as TypedInputSchema,
    input,
  ).ok;

const SEARCH =
  "https://googleads.googleapis.com/v26/customers/1234567890/googleAds:search";
const MUTATE =
  "https://googleads.googleapis.com/v26/customers/1234567890/googleAds:mutate";
const acct = { customerId: "123-456-7890" };

describe("googleAds inputs", () => {
  it("takes a customer ID with or without hyphens, and nothing else", () => {
    assert.ok(valid("customer.get", { customerId: "123-456-7890" }));
    assert.ok(valid("customer.get", { customerId: "1234567890" }));
    assert.equal(valid("customer.get", { customerId: "12345" }), false);
    assert.equal(
      valid("customer.get", { customerId: "customers/1234567890" }),
      false,
    );
    assert.equal(valid("customer.get", { ...acct, extra: 1 }), false);
  });

  it("takes a period as a dateRange or as both dates, never both kinds", () => {
    assert.ok(valid("campaign.list", acct));
    assert.ok(valid("campaign.list", { ...acct, dateRange: "LAST_7_DAYS" }));
    assert.ok(
      valid("campaign.list", {
        ...acct,
        startDate: "2026-11-01",
        endDate: "2026-11-15",
      }),
    );
    assert.equal(
      valid("campaign.list", { ...acct, startDate: "2026-11-01" }),
      false,
    );
    assert.equal(
      valid("campaign.list", {
        ...acct,
        dateRange: "LAST_7_DAYS",
        startDate: "2026-11-01",
        endDate: "2026-11-15",
      }),
      false,
    );
    assert.equal(
      valid("campaign.list", { ...acct, dateRange: "LAST_YEAR" }),
      false,
    );
  });

  it("requires a change, and lets a change only pause or enable", () => {
    assert.equal(valid("campaign.update", { ...acct, campaignId: "1" }), false);
    assert.equal(
      valid("campaign.update", {
        ...acct,
        campaignId: "1",
        validateOnly: true,
      }),
      false,
    );
    assert.ok(
      valid("campaign.update", { ...acct, campaignId: "1", status: "PAUSED" }),
    );
    assert.equal(
      valid("campaign.update", { ...acct, campaignId: "1", status: "REMOVED" }),
      false,
    );
    assert.equal(
      valid("campaign.update", { ...acct, campaignId: "x", status: "PAUSED" }),
      false,
    );
  });

  it("takes one keyword-idea seed: keywords, a url, both, or a site alone", () => {
    assert.ok(valid("keyword.ideas", { ...acct, keywords: ["shoes"] }));
    assert.ok(valid("keyword.ideas", { ...acct, url: "example.com/shoes" }));
    assert.ok(
      valid("keyword.ideas", { ...acct, keywords: ["a"], url: "example.com" }),
    );
    assert.ok(valid("keyword.ideas", { ...acct, site: "example.com" }));
    assert.equal(valid("keyword.ideas", acct), false);
    assert.equal(
      valid("keyword.ideas", { ...acct, site: "example.com", keywords: ["a"] }),
      false,
    );
  });
});

describe("googleAds credential", () => {
  it("signs the Ads API only, for the adwords scope, probing accessible accounts", () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const selection = plugin.credential?.({
      serviceAccountEmail: "robot@example.iam.gserviceaccount.com",
      serviceAccountPrivateKey: privateKey,
    });
    assert.equal(selection?.method, "serviceAccount");
    const method = selection?.type.methods.serviceAccount;
    assert.deepEqual(Object.keys(method?.targets ?? {}), ["ads"]);
    assert.equal(
      method?.targets.ads.baseUrl,
      "https://googleads.googleapis.com/",
    );
    assert.deepEqual(method?.targets.ads.allowedHeaders, ["login-customer-id"]);
    assert.deepEqual(
      method?.authentication.kind === "oauth2"
        ? method.authentication.scopes
        : undefined,
      ["https://www.googleapis.com/auth/adwords"],
    );
    assert.equal(method?.probe?.path, "v26/customers:listAccessibleCustomers");
    // Google Ads serves a service account added as a user: no subject.
    assert.equal(selection?.jwtIdentity?.subject, undefined);
  });

  it("asks consent for the adwords scope on the shared Google grant", () => {
    assert.deepEqual(plugin.oauth?.scopes, [
      "https://www.googleapis.com/auth/adwords",
    ]);
    assert.equal(plugin.oauth?.grant, "google");
  });
});

describe("googleAds requests", () => {
  it("lists accessible accounts without naming a manager", async () => {
    const calls = mock([
      () => Response.json({ resourceNames: ["customers/1234567890"] }),
    ]);
    const result = await run(
      "customer.listAccessible",
      {},
      context({ loginCustomerId: "999-888-7777" }),
    );
    assert.deepEqual(result, { resourceNames: ["customers/1234567890"] });
    assert.equal(
      calls[0].url.href,
      "https://googleads.googleapis.com/v26/customers:listAccessibleCustomers",
    );
    assert.equal(calls[0].init.method, "GET");
    assert.equal(header(calls[0], "authorization"), "Bearer access");
    assert.equal(header(calls[0], "login-customer-id"), null);
  });

  it("acts through the connection's manager, or the call's", async () => {
    const calls = mock([() => Response.json({ results: [] })]);
    const ctx = context({ loginCustomerId: "999-888-7777" });
    await run(
      "search",
      { ...acct, query: "SELECT customer.id FROM customer" },
      ctx,
    );
    await run(
      "search",
      {
        ...acct,
        loginCustomerId: "111-222-3333",
        query: "SELECT customer.id FROM customer",
      },
      ctx,
    );
    await run("search", { ...acct, query: "SELECT customer.id FROM customer" });
    assert.equal(header(calls[0], "login-customer-id"), "9998887777");
    assert.equal(header(calls[1], "login-customer-id"), "1112223333");
    assert.equal(header(calls[2], "login-customer-id"), null);
  });

  it("refuses a malformed manager ID in the connection", async () => {
    const calls = mock([() => Response.json({ results: [] })]);
    await assert.rejects(
      run(
        "search",
        { ...acct, query: "SELECT customer.id FROM customer" },
        context({ loginCustomerId: "manager" }),
      ),
      { message: "googleAds: loginCustomerId must be a 10-digit customer ID" },
    );
    assert.equal(calls.length, 0);
  });

  it("reads every page with the same query, and stops at the limit", async () => {
    const calls = mock([
      () =>
        Response.json({
          results: [{ campaign: { id: "1" } }, { campaign: { id: "2" } }],
          nextPageToken: "p2",
          totalResultsCount: "5",
          fieldMask: "campaign.id",
        }),
      () =>
        Response.json({
          results: [{ campaign: { id: "3" } }],
          summaryRow: { metrics: { clicks: "9" } },
        }),
    ]);
    const query = "SELECT campaign.id FROM campaign";
    const all = await run("search", {
      ...acct,
      query,
      summaryRow: true,
      totalResultsCount: true,
    });
    assert.deepEqual(all, {
      results: [
        { campaign: { id: "1" } },
        { campaign: { id: "2" } },
        { campaign: { id: "3" } },
      ],
      fieldMask: "campaign.id",
      totalResultsCount: "5",
      summaryRow: { metrics: { clicks: "9" } },
    });
    assert.equal(calls[0].url.href, SEARCH);
    const settings = {
      returnSummaryRow: true,
      returnTotalResultsCount: true,
    };
    assert.deepEqual(calls[0].body, { query, searchSettings: settings });
    assert.deepEqual(calls[1].body, {
      query,
      searchSettings: settings,
      pageToken: "p2",
    });

    calls.length = 0;
    const first = (await run("search", { ...acct, query, limit: 2 })) as {
      results: unknown[];
    };
    assert.equal(first.results.length, 2);
    assert.equal(calls.length, 1);
  });

  it("lists campaigns as the Campaigns screen does: no removed ones, metrics only for a period", async () => {
    const calls = mock([() => Response.json({ results: [] })]);
    await run("campaign.list", acct);
    await run("campaign.list", {
      ...acct,
      status: "PAUSED",
      dateRange: "LAST_7_DAYS",
      limit: 5,
    });
    await run("campaign.list", {
      ...acct,
      startDate: "2026-11-01",
      endDate: "2026-11-15",
    });
    const fields =
      "campaign.id, campaign.name, campaign.status, campaign.serving_status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.optimization_score, campaign_budget.id, campaign_budget.amount_micros, campaign_budget.period";
    const metrics =
      "metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.cost_micros, metrics.conversions, metrics.conversions_value";
    assert.equal(
      calls[0].body.query,
      `SELECT ${fields} FROM campaign WHERE campaign.status != 'REMOVED' ORDER BY campaign.id`,
    );
    assert.equal(
      calls[1].body.query,
      `SELECT ${fields}, ${metrics} FROM campaign WHERE campaign.status = 'PAUSED' AND segments.date DURING LAST_7_DAYS ORDER BY campaign.id LIMIT 5`,
    );
    assert.equal(
      calls[2].body.query,
      `SELECT ${fields}, ${metrics} FROM campaign WHERE campaign.status != 'REMOVED' AND segments.date BETWEEN '2026-11-01' AND '2026-11-15' ORDER BY campaign.id`,
    );
  });

  it("gets one campaign whatever its status, or null", async () => {
    const row = { campaign: { id: "42", status: "REMOVED" } };
    const calls = mock([
      () => Response.json({ results: [row] }),
      () => Response.json({}),
    ]);
    assert.deepEqual(
      await run("campaign.get", { ...acct, campaignId: "42" }),
      row,
    );
    assert.match(
      String(calls[0].body.query),
      /FROM campaign WHERE campaign\.id = 42 ORDER BY/,
    );
    assert.doesNotMatch(String(calls[0].body.query), /WHERE.*status/);
    assert.equal(
      await run("campaign.get", { ...acct, campaignId: "43" }),
      null,
    );
  });

  it("filters ads and keywords to a campaign or an ad group", async () => {
    const calls = mock([() => Response.json({ results: [] })]);
    await run("ad.list", { ...acct, adGroupId: "7" });
    await run("keyword.list", { ...acct, campaignId: "3", status: "ENABLED" });
    assert.match(
      String(calls[0].body.query),
      /FROM ad_group_ad WHERE ad_group_ad\.status != 'REMOVED' AND ad_group\.id = 7 ORDER BY ad_group_ad\.ad\.id$/,
    );
    assert.match(
      String(calls[1].body.query),
      /FROM keyword_view WHERE ad_group_criterion\.status = 'ENABLED' AND campaign\.id = 3 ORDER/,
    );
  });

  it("gets an account, or null", async () => {
    const row = { customer: { id: "1234567890", manager: true } };
    const calls = mock([
      () => Response.json({ results: [row] }),
      () => Response.json({ results: [] }),
    ]);
    assert.deepEqual(await run("customer.get", acct), row);
    assert.equal(calls[0].url.href, SEARCH);
    assert.match(
      String(calls[0].body.query),
      /^SELECT customer\.id, .* FROM customer$/,
    );
    assert.equal(await run("customer.get", acct), null);
  });

  it("lists a manager's clients, all or the direct ones", async () => {
    const calls = mock([() => Response.json({ results: [] })]);
    await run("customer.listClients", acct);
    await run("customer.listClients", {
      ...acct,
      directOnly: true,
      status: "ENABLED",
      limit: 20,
    });
    assert.match(
      String(calls[0].body.query),
      /FROM customer_client WHERE customer_client\.level > 0 ORDER BY customer_client\.level$/,
    );
    assert.match(
      String(calls[1].body.query),
      /WHERE customer_client\.level = 1 AND customer_client\.status = 'ENABLED' ORDER BY customer_client\.level LIMIT 20$/,
    );
  });

  it("reads the field catalog", async () => {
    const calls = mock([
      () =>
        Response.json({
          results: [{ name: "campaign.id" }],
          nextPageToken: "n",
        }),
      () => Response.json({ results: [{ name: "campaign.name" }] }),
      () => Response.json({ name: "campaign.status" }),
    ]);
    assert.deepEqual(
      await run("field.search", {
        query: "SELECT name WHERE name LIKE 'campaign.%'",
      }),
      [{ name: "campaign.id" }, { name: "campaign.name" }],
    );
    assert.equal(
      calls[0].url.href,
      "https://googleads.googleapis.com/v26/googleAdsFields:search",
    );
    assert.deepEqual(calls[1].body, {
      query: "SELECT name WHERE name LIKE 'campaign.%'",
      pageToken: "n",
    });
    await run("field.get", { name: "campaign.status" });
    assert.equal(
      calls[2].url.href,
      "https://googleads.googleapis.com/v26/googleAdsFields/campaign.status",
    );
    assert.equal(calls[2].init.method, "GET");
  });

  it("generates keyword ideas from the seed the call names", async () => {
    const calls = mock([
      () =>
        Response.json({
          results: [{ text: "red shoes" }],
          nextPageToken: "k2",
        }),
      () => Response.json({ results: [{ text: "blue shoes" }] }),
    ]);
    const ideas = await run("keyword.ideas", {
      ...acct,
      keywords: ["shoes"],
      url: "example.com/shoes",
      language: "languageConstants/1000",
      geoTargetConstants: ["geoTargetConstants/2840"],
    });
    assert.deepEqual(ideas, [{ text: "red shoes" }, { text: "blue shoes" }]);
    assert.equal(
      calls[0].url.href,
      "https://googleads.googleapis.com/v26/customers/1234567890:generateKeywordIdeas",
    );
    assert.deepEqual(calls[0].body, {
      keywordAndUrlSeed: { url: "example.com/shoes", keywords: ["shoes"] },
      language: "languageConstants/1000",
      geoTargetConstants: ["geoTargetConstants/2840"],
    });
    assert.equal(calls[1].body.pageToken, "k2");

    calls.length = 0;
    await run("keyword.ideas", { ...acct, site: "example.com", limit: 1 });
    assert.deepEqual(calls[0].body, {
      siteSeed: { site: "example.com" },
      pageSize: 1,
    });
    assert.equal(calls.length, 1);
  });
});

describe("googleAds changes", () => {
  it("updates only the fields given, and names them in the mask", async () => {
    const calls = mock([() => Response.json({ mutateOperationResponses: [] })]);
    await run("campaign.update", {
      ...acct,
      campaignId: "42",
      status: "PAUSED",
    });
    await run("adGroup.update", {
      ...acct,
      adGroupId: "7",
      name: "Shoes",
      cpcBidMicros: 1_500_000,
    });
    await run("campaignBudget.update", {
      ...acct,
      campaignBudgetId: "9",
      amountMicros: 50_000_000,
      validateOnly: true,
    });
    assert.equal(calls[0].url.href, MUTATE);
    assert.deepEqual(calls[0].body, {
      mutateOperations: [
        {
          campaignOperation: {
            update: {
              resourceName: "customers/1234567890/campaigns/42",
              status: "PAUSED",
            },
            updateMask: "status",
          },
        },
      ],
    });
    assert.deepEqual(calls[1].body.mutateOperations, [
      {
        adGroupOperation: {
          update: {
            resourceName: "customers/1234567890/adGroups/7",
            name: "Shoes",
            cpcBidMicros: 1_500_000,
          },
          updateMask: "name,cpc_bid_micros",
        },
      },
    ]);
    assert.deepEqual(calls[2].body, {
      mutateOperations: [
        {
          campaignBudgetOperation: {
            update: {
              resourceName: "customers/1234567890/campaignBudgets/9",
              amountMicros: 50_000_000,
            },
            updateMask: "amount_micros",
          },
        },
      ],
      validateOnly: true,
    });
  });

  it("names ads and keywords by their ad group and their own ID", async () => {
    const calls = mock([() => Response.json({ mutateOperationResponses: [] })]);
    await run("ad.update", {
      ...acct,
      adGroupId: "7",
      adId: "8",
      status: "ENABLED",
    });
    await run("keyword.remove", { ...acct, adGroupId: "7", criterionId: "5" });
    assert.equal(
      (
        calls[0].body.mutateOperations as {
          adGroupAdOperation: { update: { resourceName: string } };
        }[]
      )[0].adGroupAdOperation.update.resourceName,
      "customers/1234567890/adGroupAds/7~8",
    );
    assert.deepEqual(calls[1].body.mutateOperations, [
      {
        adGroupCriterionOperation: {
          remove: "customers/1234567890/adGroupCriteria/7~5",
        },
      },
    ]);
  });

  it("adds each keyword as its own operation", async () => {
    const calls = mock([() => Response.json({ mutateOperationResponses: [] })]);
    await run("keyword.create", {
      ...acct,
      adGroupId: "7",
      keywords: [
        { text: "red shoes", matchType: "PHRASE" },
        { text: "shoes", matchType: "EXACT" },
      ],
      status: "PAUSED",
      partialFailure: true,
    });
    const adGroup = "customers/1234567890/adGroups/7";
    assert.deepEqual(calls[0].body, {
      mutateOperations: [
        {
          adGroupCriterionOperation: {
            create: {
              adGroup,
              keyword: { text: "red shoes", matchType: "PHRASE" },
              status: "PAUSED",
            },
          },
        },
        {
          adGroupCriterionOperation: {
            create: {
              adGroup,
              keyword: { text: "shoes", matchType: "EXACT" },
              status: "PAUSED",
            },
          },
        },
      ],
      partialFailure: true,
    });
  });

  it("sends any operations through mutate as given", async () => {
    const answer = {
      mutateOperationResponses: [{ campaignResult: { resourceName: "x" } }],
    };
    const calls = mock([() => Response.json(answer)]);
    const operations = [
      { campaignOperation: { remove: "customers/1234567890/campaigns/1" } },
    ];
    assert.deepEqual(
      await run("mutate", {
        ...acct,
        mutateOperations: operations,
        responseContentType: "MUTABLE_RESOURCE",
      }),
      answer,
    );
    assert.deepEqual(calls[0].body, {
      mutateOperations: operations,
      responseContentType: "MUTABLE_RESOURCE",
    });
  });
});

describe("googleAds failures", () => {
  const failure = (status: number, error: Record<string, unknown>) => () =>
    Response.json(
      { error: { code: status, ...error } },
      { status, headers: { "request-id": "rq-7" } },
    );

  it("reads GoogleAdsFailure's codes and fields, never its messages", () => {
    assert.deepEqual(
      adsFailure({
        error: {
          status: "INVALID_ARGUMENT",
          message: "secret-ish text",
          details: [
            {
              "@type":
                "type.googleapis.com/google.ads.googleads.v26.errors.GoogleAdsFailure",
              errors: [
                {
                  errorCode: { fieldError: "REQUIRED" },
                  message: "The required field was not present.",
                  location: {
                    fieldPathElements: [
                      { fieldName: "operations", index: 0 },
                      { fieldName: "create" },
                      { fieldName: "name" },
                    ],
                  },
                },
                { errorCode: { stringLengthError: "TOO_SHORT" } },
              ],
              requestId: "rq-7",
            },
          ],
        },
      }),
      { code: "fieldError.REQUIRED", param: ["operations.0.create.name"] },
    );
    assert.deepEqual(adsFailure({ error: { status: "UNAUTHENTICATED" } }), {
      code: "UNAUTHENTICATED",
      param: [],
    });
    assert.deepEqual(adsFailure(null), { code: undefined, param: [] });
  });

  it("reports the status, Google's code and the request-id", async () => {
    mock([
      failure(400, {
        status: "INVALID_ARGUMENT",
        message: "Request contains an invalid argument.",
        details: [
          {
            errors: [
              {
                errorCode: { queryError: "UNRECOGNIZED_FIELD" },
                message: "Unrecognized field in the query: 'campaign.nme'.",
              },
            ],
          },
        ],
      }),
    ]);
    await assert.rejects(
      run("search", { ...acct, query: "SELECT campaign.nme FROM campaign" }),
      {
        message:
          "googleAds: request failed (HTTP 400 queryError.UNRECOGNIZED_FIELD) (request-id rq-7)",
        status: 400,
      },
    );
  });

  it("says a change's outcome is unknown when Google fails it with a 5xx", async () => {
    mock([failure(503, { status: "UNAVAILABLE" })]);
    await assert.rejects(
      run("campaign.update", { ...acct, campaignId: "1", status: "PAUSED" }),
      {
        message:
          "googleAds: request failed (HTTP 503 UNAVAILABLE) (request-id rq-7). The change may have been applied: check before sending it again.",
        status: 503,
      },
    );
    // A read, or a change that was only validated, applies nothing.
    await assert.rejects(
      run("search", { ...acct, query: "SELECT campaign.id FROM campaign" }),
      {
        message:
          "googleAds: request failed (HTTP 503 UNAVAILABLE) (request-id rq-7)",
      },
    );
    await assert.rejects(
      run("campaign.update", {
        ...acct,
        campaignId: "1",
        status: "PAUSED",
        validateOnly: true,
      }),
      {
        message:
          "googleAds: request failed (HTTP 503 UNAVAILABLE) (request-id rq-7)",
      },
    );
  });

  it("says a change's outcome is unknown when it gets no answer, keeping the code", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(
      run("keyword.remove", { ...acct, adGroupId: "7", criterionId: "5" }),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "transport_failed");
        assert.match(error.message, /The change may have been applied/);
        return true;
      },
    );
    await assert.rejects(
      run("search", { ...acct, query: "SELECT campaign.id FROM campaign" }),
      (error: Error & { code?: string }) => {
        assert.equal(error.code, "transport_failed");
        assert.doesNotMatch(error.message, /may have been applied/);
        return true;
      },
    );
  });
});
