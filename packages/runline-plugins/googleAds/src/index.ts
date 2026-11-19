/**
 * Google Ads plugin for runline, on the Google Ads API's REST interface.
 *
 * Reads are Google Ads Query Language (GAQL) searches: `search` runs any
 * query, and the list and get actions run the reports of the Google Ads
 * UI's own screens, as Google's Query Cookbook writes them. Rows keep the
 * API's shape (`{ campaign, campaignBudget, metrics }`), and money is in
 * micros: 1,000,000 micros are one unit of the account's currency.
 *
 * Every change goes through GoogleAdsService.Mutate: `mutate` takes any
 * operations, and the typed actions build the common ones. Each change
 * takes `validateOnly` to check it without applying it.
 *
 * The login is Google's OAuth, shared with the other Google plugins. A
 * login that reaches an account through a manager account names that
 * manager as `loginCustomerId`, on the connection or the call.
 */
import {
  type ActionContext,
  pathSegment,
  type RunlinePluginAPI,
} from "runline";
import * as t from "typebox";
import { googleCredential, googleOAuth } from "../../_shared/googleAuth.js";
import {
  googleConnection,
  RawGoogleObject,
} from "../../_shared/googleSchemas.js";
import { atLeastOne, stringEnum } from "../../_shared/schemas.js";
import {
  type Account,
  account,
  adsRequest,
  collect,
  customerIdSchema,
  customerPath,
  gaql,
  limit,
  METRICS,
  micros,
  mutate,
  PERIOD_RULE,
  type Period,
  PLUGIN,
  period,
  periodCondition,
  RESPONSE_CONTENT_TYPES,
  resourceId,
  resourceName,
  SCOPES,
  STRICT,
  type Status,
  search,
  servingStatus,
  statusCondition,
  statusFilter,
  update,
  validateOnly,
} from "./shared.js";

// ─── Reports ────────────────────────────────────────────────────

interface Report {
  select: string[];
  from: string;
  where?: (string | undefined)[];
  orderBy?: string;
}

/**
 * A report's rows: the resource's own fields, and its metrics when a
 * period is given, under the report's conditions.
 */
async function report(
  ctx: ActionContext,
  input: Account & Period & { limit?: number },
  query: Report,
): Promise<unknown[]> {
  const metricsPeriod = periodCondition(input);
  const { results } = await search(
    ctx,
    input,
    gaql({
      select: metricsPeriod ? [...query.select, ...METRICS] : query.select,
      from: query.from,
      where: [...(query.where ?? []), metricsPeriod],
      orderBy: query.orderBy,
      limit: input.limit,
    }),
  );
  return results;
}

/** A list: every status but REMOVED, unless the call asks for one. */
function list(
  ctx: ActionContext,
  input: Account & Period & { status?: Status; limit?: number },
  query: Report & { statusField: string },
): Promise<unknown[]> {
  const { statusField, ...rest } = query;
  return report(ctx, input, {
    ...rest,
    where: [statusCondition(statusField, input.status), ...(rest.where ?? [])],
  });
}

/** One resource by ID, whatever its status, or null. */
async function get(
  ctx: ActionContext,
  input: Account & Period,
  query: Report,
): Promise<unknown> {
  return (await report(ctx, input, query))[0] ?? null;
}

const idIs = (field: string, id: string | undefined) =>
  id === undefined ? undefined : `${field} = ${id}`;

const CAMPAIGN_FIELDS = [
  "campaign.id",
  "campaign.name",
  "campaign.status",
  "campaign.serving_status",
  "campaign.advertising_channel_type",
  "campaign.bidding_strategy_type",
  "campaign.optimization_score",
  "campaign_budget.id",
  "campaign_budget.amount_micros",
  "campaign_budget.period",
];
const AD_GROUP_FIELDS = [
  "ad_group.id",
  "ad_group.name",
  "ad_group.status",
  "ad_group.type",
  "ad_group.cpc_bid_micros",
  "campaign.id",
  "campaign.name",
];
const AD_FIELDS = [
  "ad_group_ad.ad.id",
  "ad_group_ad.ad.name",
  "ad_group_ad.ad.type",
  "ad_group_ad.ad.final_urls",
  "ad_group_ad.ad.responsive_search_ad.headlines",
  "ad_group_ad.ad.responsive_search_ad.descriptions",
  "ad_group_ad.status",
  "ad_group_ad.ad_strength",
  "ad_group_ad.policy_summary.approval_status",
  "ad_group.id",
  "ad_group.name",
  "campaign.id",
  "campaign.name",
];
const KEYWORD_FIELDS = [
  "ad_group_criterion.criterion_id",
  "ad_group_criterion.keyword.text",
  "ad_group_criterion.keyword.match_type",
  "ad_group_criterion.status",
  "ad_group_criterion.negative",
  "ad_group_criterion.cpc_bid_micros",
  "ad_group_criterion.system_serving_status",
  "ad_group_criterion.approval_status",
  "ad_group_criterion.quality_info.quality_score",
  "ad_group.id",
  "ad_group.name",
  "campaign.id",
  "campaign.name",
];

// ─── Input schemas ──────────────────────────────────────────────

const campaignId = resourceId("Campaign");
const adGroupId = resourceId("Ad group");
/** A list's input: the account, its filters, a status, a period, a limit. */
const listOf = <F extends t.TProperties>(filters: F) =>
  t.Object(
    { ...account, ...filters, status: statusFilter, ...period, limit },
    { ...STRICT, ...PERIOD_RULE },
  );
/** A get's input: the account, the resource's ID, a period. */
const byId = <K extends t.TProperties>(key: K) =>
  t.Object({ ...account, ...key, ...period }, { ...STRICT, ...PERIOD_RULE });
/**
 * A change's input: the account, the resource and its fields, and
 * validateOnly. With `changes`, at least one of those fields is required.
 */
const change = <F extends t.TProperties>(
  fields: F,
  changes?: (keyof F & string)[],
) =>
  t.Object(
    { ...account, ...fields, validateOnly },
    changes
      ? {
          ...STRICT,
          ...atLeastOne(
            Object.fromEntries(changes.map((name) => [name, fields[name]])),
          ),
        }
      : STRICT,
  );

const empty = t.Object({}, STRICT);
const customerGet = t.Object(account, STRICT);
const customerListClients = t.Object(
  {
    ...account,
    directOnly: t.Optional(
      t.Boolean({
        description:
          "Only the manager's direct clients (level 1), not every descendant",
      }),
    ),
    status: t.Optional(
      stringEnum(["ENABLED", "CANCELED", "SUSPENDED", "CLOSED"] as const, {
        description: "Only accounts with this status",
      }),
    ),
    limit,
  },
  STRICT,
);
const searchInput = t.Object(
  {
    ...account,
    query: t.String({
      minLength: 1,
      description:
        "GAQL, e.g. SELECT campaign.name, metrics.clicks FROM campaign WHERE segments.date DURING LAST_7_DAYS",
    }),
    limit: t.Optional(
      t.Integer({
        minimum: 1,
        description:
          "Stop after this many rows (default all). A LIMIT clause in the query stops Google sooner.",
      }),
    ),
    summaryRow: t.Optional(
      t.Boolean({
        description: "Also answer summaryRow: the metrics over every row",
      }),
    ),
    totalResultsCount: t.Optional(
      t.Boolean({
        description:
          "Also answer totalResultsCount: the rows matched, ignoring LIMIT",
      }),
    ),
  },
  STRICT,
);
const mutateInput = t.Object(
  {
    ...account,
    mutateOperations: t.Array(RawGoogleObject, {
      minItems: 1,
      maxItems: 10000,
      description:
        "MutateOperation objects, each one operation keyed by its type: { campaignOperation: { update: {...}, updateMask: 'status' } }. A negative ID (customers/1/campaigns/-1) names a resource created earlier in the same request.",
    }),
    partialFailure: t.Optional(
      t.Boolean({
        description:
          "Apply the valid operations and answer the failures in partialFailureError, instead of all or nothing",
      }),
    ),
    validateOnly,
    responseContentType: t.Optional(
      stringEnum(RESPONSE_CONTENT_TYPES, {
        description:
          "MUTABLE_RESOURCE answers each changed resource, not just its name",
      }),
    ),
  },
  STRICT,
);
const fieldSearch = t.Object(
  {
    query: t.String({
      minLength: 1,
      description:
        "GAQL over field metadata, with no FROM: SELECT name, selectable, filterable, data_type WHERE name LIKE 'campaign.%'",
    }),
    limit,
  },
  STRICT,
);
const fieldGet = t.Object(
  {
    name: t.String({
      pattern: "^[a-z][a-zA-Z0-9._]*$",
      description: "A resource, field, segment or metric: campaign.status",
    }),
  },
  STRICT,
);

const campaignList = listOf({});
const campaignGet = byId({ campaignId });
const campaignUpdate = change(
  {
    campaignId,
    name: t.Optional(t.String({ minLength: 1, maxLength: 256 })),
    status: t.Optional(servingStatus("campaign")),
  },
  ["name", "status"],
);
const campaignRemove = change({ campaignId });
const budgetUpdate = change(
  {
    campaignBudgetId: resourceId("Campaign budget"),
    amountMicros: t.Optional(micros("The budget per period")),
    name: t.Optional(t.String({ minLength: 1 })),
  },
  ["amountMicros", "name"],
);

const adGroupList = listOf({ campaignId: t.Optional(campaignId) });
const adGroupGet = byId({ adGroupId });
const adGroupUpdate = change(
  {
    adGroupId,
    name: t.Optional(t.String({ minLength: 1, maxLength: 256 })),
    status: t.Optional(servingStatus("ad group")),
    cpcBidMicros: t.Optional(micros("The default cost-per-click bid")),
  },
  ["name", "status", "cpcBidMicros"],
);
const adGroupRemove = change({ adGroupId });

const adList = listOf({
  campaignId: t.Optional(campaignId),
  adGroupId: t.Optional(adGroupId),
});
const adUpdate = change({
  adGroupId,
  adId: resourceId("Ad"),
  status: servingStatus("ad"),
});
const adRemove = change({ adGroupId, adId: resourceId("Ad") });

const MATCH_TYPES = ["EXACT", "PHRASE", "BROAD"] as const;
const criterionId = resourceId("Keyword criterion");
const keywordList = listOf({
  campaignId: t.Optional(campaignId),
  adGroupId: t.Optional(adGroupId),
});
const keywordCreate = t.Object(
  {
    ...account,
    adGroupId,
    keywords: t.Array(
      t.Object(
        {
          text: t.String({ minLength: 1, maxLength: 80 }),
          matchType: stringEnum(MATCH_TYPES),
        },
        STRICT,
      ),
      { minItems: 1, maxItems: 10000 },
    ),
    negative: t.Optional(
      t.Boolean({
        description: "Exclude these searches from the ad group instead",
      }),
    ),
    status: t.Optional(servingStatus("keyword")),
    cpcBidMicros: t.Optional(micros("The keywords' cost-per-click bid")),
    partialFailure: t.Optional(
      t.Boolean({
        description:
          "Add the valid keywords and answer the rest in partialFailureError",
      }),
    ),
    validateOnly,
  },
  STRICT,
);
const keywordUpdate = change(
  {
    adGroupId,
    criterionId,
    status: t.Optional(servingStatus("keyword")),
    cpcBidMicros: t.Optional(micros("The keyword's cost-per-click bid")),
  },
  ["status", "cpcBidMicros"],
);
const keywordRemove = change({ adGroupId, criterionId });
const keywordIdeas = t.Object(
  {
    ...account,
    keywords: t.Optional(
      t.Array(t.String({ minLength: 1 }), {
        minItems: 1,
        description: "Seed keywords or phrases",
      }),
    ),
    url: t.Optional(
      t.String({
        minLength: 1,
        description:
          "Seed page (www.example.com/shoes), alone or with keywords",
      }),
    ),
    site: t.Optional(
      t.String({
        minLength: 1,
        description: "Seed site (www.example.com), on its own",
      }),
    ),
    language: t.Optional(
      t.String({
        pattern: "^languageConstants/\\d+$",
        description: "languageConstants/1000 (English); default every language",
      }),
    ),
    geoTargetConstants: t.Optional(
      t.Array(t.String({ pattern: "^geoTargetConstants/\\d+$" }), {
        maxItems: 10,
        description:
          "Locations, as geoTargetConstants/2840 (United States); default everywhere",
      }),
    ),
    keywordPlanNetwork: t.Optional(
      stringEnum(["GOOGLE_SEARCH", "GOOGLE_SEARCH_AND_PARTNERS"] as const, {
        description: "Default GOOGLE_SEARCH_AND_PARTNERS",
      }),
    ),
    includeAdultKeywords: t.Optional(t.Boolean()),
    limit,
  },
  {
    ...STRICT,
    // One seed: keywords, a url, both, or a site alone.
    anyOf: [
      { required: ["keywords"], not: { required: ["site"] } },
      { required: ["url"], not: { required: ["site"] } },
      {
        required: ["site"],
        not: { anyOf: [{ required: ["keywords"] }, { required: ["url"] }] },
      },
    ],
  },
);

type In<S extends t.TSchema> = t.Static<S>;

/** The seed a keyword-ideas request names. */
function seed(input: In<typeof keywordIdeas>): Record<string, unknown> {
  if (input.site) return { siteSeed: { site: input.site } };
  if (input.url && input.keywords)
    return { keywordAndUrlSeed: { url: input.url, keywords: input.keywords } };
  if (input.url) return { urlSeed: { url: input.url } };
  return { keywordSeed: { keywords: input.keywords } };
}

// ─── Plugin ─────────────────────────────────────────────────────

export default function googleAds(rl: RunlinePluginAPI) {
  rl.setName(PLUGIN);
  rl.setVersion("0.1.0");
  rl.setCredential(googleCredential(PLUGIN, SCOPES));

  const oauth = googleOAuth(PLUGIN, SCOPES, "GOOGLE_ADS");
  rl.setOAuth({
    ...oauth,
    setupHelp: [
      ...(oauth.setupHelp ?? []),
      "",
      "Google Ads grants API access to the Cloud project: a new project has",
      "Test access, which reaches test accounts only. Apply for Explorer",
      "access to reach real accounts:",
      "  https://console.cloud.google.com/google/ads-apis/overview",
      "No developer token is needed.",
    ],
  });

  rl.setConnectionSchema(
    t.Object({
      ...googleConnection("GOOGLE_ADS"),
      loginCustomerId: t.Optional(
        customerIdSchema(
          "Manager account the login reaches client accounts through; calls may name another",
          { env: "GOOGLE_ADS_LOGIN_CUSTOMER_ID" },
        ),
      ),
    }),
  );

  // ── Accounts ───────────────────────────────────────

  rl.registerAction("customer.listAccessible", {
    access: "read",
    description:
      "The accounts the login has direct access to, as resourceNames (customers/1234567890). Accounts reached through a manager are its clients: customer.listClients.",
    inputSchema: empty,
    async execute(_input, ctx) {
      return adsRequest(ctx, { path: "customers:listAccessibleCustomers" });
    },
  });

  rl.registerAction("customer.get", {
    access: "read",
    description:
      "An account's name, currency, time zone, status, and whether it is a manager or a test account",
    inputSchema: customerGet,
    async execute(input, ctx) {
      return get(ctx, input, {
        select: [
          "customer.id",
          "customer.descriptive_name",
          "customer.currency_code",
          "customer.time_zone",
          "customer.status",
          "customer.manager",
          "customer.test_account",
          "customer.auto_tagging_enabled",
          "customer.optimization_score",
        ],
        from: "customer",
      });
    },
  });

  rl.registerAction("customer.listClients", {
    access: "read",
    description:
      "A manager account's client accounts: every descendant with its level (1 is a direct client), or the direct clients only. Run it with the manager as customerId.",
    inputSchema: customerListClients,
    async execute(input, ctx) {
      const p = input;
      return report(ctx, p, {
        select: [
          "customer_client.id",
          "customer_client.client_customer",
          "customer_client.descriptive_name",
          "customer_client.level",
          "customer_client.manager",
          "customer_client.status",
          "customer_client.currency_code",
          "customer_client.time_zone",
          "customer_client.test_account",
        ],
        from: "customer_client",
        where: [
          // Level 0 is the manager itself.
          p.directOnly
            ? "customer_client.level = 1"
            : "customer_client.level > 0",
          p.status ? `customer_client.status = '${p.status}'` : undefined,
        ],
        orderBy: "customer_client.level",
      });
    },
  });

  // ── Reporting ──────────────────────────────────────

  rl.registerAction("search", {
    access: "read",
    description:
      "Run a GAQL query: any resource, its attributed resources, segments and metrics. Answers rows in the API's shape ({ campaign: {...}, metrics: {...} }); money is in micros. Build or check queries with field.search.",
    inputSchema: searchInput,
    async execute(input, ctx) {
      const {
        query,
        limit: rows,
        summaryRow,
        totalResultsCount,
        ...rest
      } = input;
      return search(ctx, rest, query, {
        limit: rows,
        summaryRow,
        totalResultsCount,
      });
    },
  });

  rl.registerAction("field.search", {
    access: "read",
    description:
      "Search the catalog of GAQL resources, fields, segments and metrics: what each is, and which can be selected, filtered or sorted together",
    inputSchema: fieldSearch,
    async execute(input, ctx) {
      const p = input;
      return collect(
        ctx,
        { path: "googleAdsFields:search", body: { query: p.query } },
        p.limit,
      );
    },
  });

  rl.registerAction("field.get", {
    access: "read",
    description: "One GAQL resource, field, segment or metric from the catalog",
    inputSchema: fieldGet,
    async execute(input, ctx) {
      const { name } = input;
      return adsRequest(ctx, { path: `googleAdsFields/${pathSegment(name)}` });
    },
  });

  // ── Changes ────────────────────────────────────────

  rl.registerAction("mutate", {
    access: "write",
    description:
      "Create, update or remove any resources in one request (GoogleAdsService.Mutate). All operations apply together, or none do unless partialFailure is set. An update names its changed fields in updateMask, in snake_case.",
    inputSchema: mutateInput,
    async execute(input, ctx) {
      const { mutateOperations, ...options } = input;
      return mutate(ctx, options, mutateOperations);
    },
  });

  // ── Campaigns ──────────────────────────────────────

  rl.registerAction("campaign.list", {
    access: "read",
    description:
      "Campaigns with their status, channel, bidding and budget; with a period, also impressions, clicks, CTR, average CPC, cost and conversions",
    inputSchema: campaignList,
    async execute(input, ctx) {
      return list(ctx, input, {
        select: CAMPAIGN_FIELDS,
        from: "campaign",
        statusField: "campaign.status",
        orderBy: "campaign.id",
      });
    },
  });

  rl.registerAction("campaign.get", {
    access: "read",
    description:
      "One campaign, as campaign.list reports it; null when there is none",
    inputSchema: campaignGet,
    async execute(input, ctx) {
      const p = input;
      return get(ctx, p, {
        select: CAMPAIGN_FIELDS,
        from: "campaign",
        where: [idIs("campaign.id", p.campaignId)],
        orderBy: "campaign.id",
      });
    },
  });

  rl.registerAction("campaign.update", {
    access: "write",
    description: "Rename a campaign, or pause or enable it",
    inputSchema: campaignUpdate,
    async execute(input, ctx) {
      const { campaignId: id, name, status, ...options } = input;
      return mutate(ctx, options, [
        {
          campaignOperation: update(
            resourceName(options.customerId, "campaigns", id),
            { name, status },
          ),
        },
      ]);
    },
  });

  rl.registerAction("campaign.remove", {
    access: "write",
    description:
      "Remove a campaign. Its status becomes REMOVED, which cannot be undone.",
    inputSchema: campaignRemove,
    async execute(input, ctx) {
      const { campaignId: id, ...options } = input;
      return mutate(ctx, options, [
        {
          campaignOperation: {
            remove: resourceName(options.customerId, "campaigns", id),
          },
        },
      ]);
    },
  });

  rl.registerAction("campaignBudget.update", {
    access: "write",
    description:
      "Change a campaign budget's amount (micros per period) or name. A shared budget changes for every campaign using it. campaign.list reports each campaign's budget ID.",
    inputSchema: budgetUpdate,
    async execute(input, ctx) {
      const { campaignBudgetId: id, amountMicros, name, ...options } = input;
      return mutate(ctx, options, [
        {
          campaignBudgetOperation: update(
            resourceName(options.customerId, "campaignBudgets", id),
            { amount_micros: amountMicros, name },
          ),
        },
      ]);
    },
  });

  // ── Ad groups ──────────────────────────────────────

  rl.registerAction("adGroup.list", {
    access: "read",
    description:
      "Ad groups, of every campaign or one, with their status, type and default bid; with a period, also their performance",
    inputSchema: adGroupList,
    async execute(input, ctx) {
      const p = input;
      return list(ctx, p, {
        select: AD_GROUP_FIELDS,
        from: "ad_group",
        statusField: "ad_group.status",
        where: [idIs("campaign.id", p.campaignId)],
        orderBy: "ad_group.id",
      });
    },
  });

  rl.registerAction("adGroup.get", {
    access: "read",
    description:
      "One ad group, as adGroup.list reports it; null when there is none",
    inputSchema: adGroupGet,
    async execute(input, ctx) {
      const p = input;
      return get(ctx, p, {
        select: AD_GROUP_FIELDS,
        from: "ad_group",
        where: [idIs("ad_group.id", p.adGroupId)],
        orderBy: "ad_group.id",
      });
    },
  });

  rl.registerAction("adGroup.update", {
    access: "write",
    description: "Rename an ad group, pause or enable it, or change its bid",
    inputSchema: adGroupUpdate,
    async execute(input, ctx) {
      const { adGroupId: id, name, status, cpcBidMicros, ...options } = input;
      return mutate(ctx, options, [
        {
          adGroupOperation: update(
            resourceName(options.customerId, "adGroups", id),
            { name, status, cpc_bid_micros: cpcBidMicros },
          ),
        },
      ]);
    },
  });

  rl.registerAction("adGroup.remove", {
    access: "write",
    description:
      "Remove an ad group. Its status becomes REMOVED, which cannot be undone.",
    inputSchema: adGroupRemove,
    async execute(input, ctx) {
      const { adGroupId: id, ...options } = input;
      return mutate(ctx, options, [
        {
          adGroupOperation: {
            remove: resourceName(options.customerId, "adGroups", id),
          },
        },
      ]);
    },
  });

  // ── Ads ────────────────────────────────────────────

  rl.registerAction("ad.list", {
    access: "read",
    description:
      "Ads with their type, final URLs, responsive search ad text, status, strength and approval; with a period, also their performance",
    inputSchema: adList,
    async execute(input, ctx) {
      const p = input;
      return list(ctx, p, {
        select: AD_FIELDS,
        from: "ad_group_ad",
        statusField: "ad_group_ad.status",
        where: [
          idIs("campaign.id", p.campaignId),
          idIs("ad_group.id", p.adGroupId),
        ],
        orderBy: "ad_group_ad.ad.id",
      });
    },
  });

  rl.registerAction("ad.update", {
    access: "write",
    description: "Pause or enable an ad in its ad group",
    inputSchema: adUpdate,
    async execute(input, ctx) {
      const { adGroupId: group, adId, status, ...options } = input;
      return mutate(ctx, options, [
        {
          adGroupAdOperation: update(
            resourceName(options.customerId, "adGroupAds", group, adId),
            { status },
          ),
        },
      ]);
    },
  });

  rl.registerAction("ad.remove", {
    access: "write",
    description:
      "Remove an ad from its ad group. Its status becomes REMOVED, which cannot be undone.",
    inputSchema: adRemove,
    async execute(input, ctx) {
      const { adGroupId: group, adId, ...options } = input;
      return mutate(ctx, options, [
        {
          adGroupAdOperation: {
            remove: resourceName(options.customerId, "adGroupAds", group, adId),
          },
        },
      ]);
    },
  });

  // ── Keywords ───────────────────────────────────────

  rl.registerAction("keyword.list", {
    access: "read",
    description:
      "Keywords with their text, match type, status, bid, serving and approval status and quality score; with a period, also their performance",
    inputSchema: keywordList,
    async execute(input, ctx) {
      const p = input;
      return list(ctx, p, {
        select: KEYWORD_FIELDS,
        from: "keyword_view",
        statusField: "ad_group_criterion.status",
        where: [
          idIs("campaign.id", p.campaignId),
          idIs("ad_group.id", p.adGroupId),
        ],
        orderBy: "ad_group_criterion.criterion_id",
      });
    },
  });

  rl.registerAction("keyword.create", {
    access: "write",
    description:
      "Add keywords to an ad group, each with its match type; negative ones exclude searches instead",
    inputSchema: keywordCreate,
    async execute(input, ctx) {
      const {
        adGroupId: group,
        keywords,
        negative,
        status,
        cpcBidMicros,
        ...options
      } = input;
      const adGroup = resourceName(options.customerId, "adGroups", group);
      return mutate(
        ctx,
        options,
        keywords.map((keyword) => ({
          adGroupCriterionOperation: {
            create: { adGroup, keyword, negative, status, cpcBidMicros },
          },
        })),
      );
    },
  });

  rl.registerAction("keyword.update", {
    access: "write",
    description: "Pause or enable a keyword, or change its bid",
    inputSchema: keywordUpdate,
    async execute(input, ctx) {
      const {
        adGroupId: group,
        criterionId: id,
        status,
        cpcBidMicros,
        ...options
      } = input;
      return mutate(ctx, options, [
        {
          adGroupCriterionOperation: update(
            resourceName(options.customerId, "adGroupCriteria", group, id),
            { status, cpc_bid_micros: cpcBidMicros },
          ),
        },
      ]);
    },
  });

  rl.registerAction("keyword.remove", {
    access: "write",
    description: "Remove a keyword from its ad group",
    inputSchema: keywordRemove,
    async execute(input, ctx) {
      const { adGroupId: group, criterionId: id, ...options } = input;
      return mutate(ctx, options, [
        {
          adGroupCriterionOperation: {
            remove: resourceName(
              options.customerId,
              "adGroupCriteria",
              group,
              id,
            ),
          },
        },
      ]);
    },
  });

  rl.registerAction("keyword.ideas", {
    access: "read",
    description:
      "Keyword ideas from Keyword Planner, from seed keywords, a page, both, or a site: each with its average monthly searches, competition and top-of-page bid range. Google allows one request a second per account.",
    inputSchema: keywordIdeas,
    async execute(input, ctx) {
      const p = input;
      return collect(
        ctx,
        {
          path: `${customerPath(p.customerId)}:generateKeywordIdeas`,
          // Options left undefined drop out of the JSON body.
          body: {
            ...seed(p),
            language: p.language,
            geoTargetConstants: p.geoTargetConstants,
            keywordPlanNetwork: p.keywordPlanNetwork,
            includeAdultKeywords: p.includeAdultKeywords,
          },
          account: p,
        },
        p.limit,
      );
    },
  });
}
