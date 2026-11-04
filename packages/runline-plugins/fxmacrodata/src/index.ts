/**
 * FXMacroData plugin for runline: official macroeconomic releases, release
 * calendars, indicator catalogues and FX rates for 22 currencies, read from
 * https://api.fxmacrodata.com/v1.
 *
 * Auth: an optional API key (header `X-API-Key`), via the `apiKey`
 * connection field (env `FXMACRODATA_API_KEY`). Without one, USD releases
 * (the last 90 days, 15 minutes delayed), the USD calendar and every
 * currency's catalogue still answer; other currencies and FX rates need a
 * key from https://fxmacrodata.com/subscribe.
 *
 *   await fxmacrodata.announcement.latest({ currency: "USD" })
 *   await fxmacrodata.announcement.list({ currency: "USD", indicator: "inflation", limit: 12 })
 *   await fxmacrodata.calendar.list({ currency: "USD", indicator: "non_farm_payrolls" })
 */
import type { ActionContext, RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { fxmacrodataCredential } from "./credentials.js";
import {
  type Answer,
  currencyCode,
  dateRange,
  getAnswer,
  indicatorSlug,
  MAX_LIMIT,
  MAX_PAGES,
  NAME,
  nextOffset,
  noticesOf,
  rowsOf,
  wholeNumber,
} from "./shared.js";

const CURRENCY = t.String({
  description:
    "3-letter currency code: AUD, BRL, CAD, CHF, CNH, CNY, DKK, EUR, GBP, HUF, ILS, JPY, KRW, MYR, NGN, NOK, NZD, PEN, SEK, THB, TWD or USD",
});

const DATE_RANGE = {
  startDate: t.Optional(t.String({ description: "From date, YYYY-MM-DD" })),
  endDate: t.Optional(t.String({ description: "To date, YYYY-MM-DD" })),
};

const PAGING = {
  limit: t.Optional(
    t.Integer({
      minimum: 1,
      maximum: MAX_LIMIT,
      description: `Rows per page, 1-${MAX_LIMIT} (default 20)`,
    }),
  ),
  offset: t.Optional(
    t.Integer({ minimum: 0, description: "Rows to skip (default 0)" }),
  ),
  all: t.Optional(
    t.Boolean({
      description: `Follow pagination.next_offset until the last page (at most ${MAX_PAGES} pages)`,
    }),
  ),
};

/**
 * A list endpoint's rows: one page, or every page from `offset` on when
 * `all` is set. The first page's metadata is kept; `nextOffset` says where
 * a further call would continue, null once the last page is read.
 */
async function pagedRows(
  ctx: ActionContext,
  path: string,
  query: Answer,
  input: Answer,
): Promise<Answer> {
  const limit = wholeNumber(input.limit, "limit", {
    min: 1,
    max: MAX_LIMIT,
    fallback: 20,
  });
  let offset = wholeNumber(input.offset, "offset", {
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    fallback: 0,
  });
  const first = await getAnswer(ctx, path, { ...query, limit, offset });
  const rows = [...rowsOf(first)];
  let next = nextOffset(first, offset);
  for (let pages = 1; input.all === true && next !== undefined; pages++) {
    if (pages >= MAX_PAGES) break;
    offset = next;
    const page = await getAnswer(ctx, path, { ...query, limit, offset });
    rows.push(...rowsOf(page));
    next = nextOffset(page, offset);
  }
  return {
    ...first,
    data: rows,
    nextOffset: next ?? null,
    notices: noticesOf(first),
  };
}

export default function fxmacrodata(rl: RunlinePluginAPI): void {
  rl.setName(NAME);
  rl.setVersion("0.1.0");
  rl.setCredential(fxmacrodataCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: false,
      env: "FXMACRODATA_API_KEY",
      description:
        "FXMacroData API key, sent as the X-API-Key header. Optional: USD releases, the USD calendar and the data catalogue work without one.",
    },
  });

  rl.registerAction("announcement.latest", {
    access: "read",
    description:
      "Latest released value of every indicator for one currency. `date` is the reference period; `announcement_datetime` is when it was published. `notices` carries free-tier delay messages.",
    inputSchema: t.Object({ currency: CURRENCY }),
    async execute(input, ctx) {
      const currency = currencyCode((input as Answer).currency);
      const answer = await getAnswer(ctx, `announcements/${currency}/latest`);
      rowsOf(answer);
      return { ...answer, notices: noticesOf(answer) };
    },
  });

  rl.registerAction("announcement.list", {
    access: "read",
    description:
      "Release history for one indicator, most recent first. `date` is the reference period; `announcement_datetime` is the release time. Indicator slugs come from catalogue.get. `notices` carries free-tier window and delay messages.",
    inputSchema: t.Object({
      currency: CURRENCY,
      indicator: t.String({
        description: "Indicator slug, e.g. inflation, policy_rate",
      }),
      ...DATE_RANGE,
      ...PAGING,
    }),
    async execute(input, ctx) {
      const p = input as Answer;
      const currency = currencyCode(p.currency);
      const indicator = indicatorSlug(p.indicator);
      return pagedRows(
        ctx,
        `announcements/${currency}/${indicator}`,
        dateRange(p),
        p,
      );
    },
  });

  rl.registerAction("calendar.list", {
    access: "read",
    description:
      "Scheduled releases for one currency. Release timing is `announcement_datetime` (Unix seconds, also as UTC and local ISO strings); a row's `date` is the reference period the release covers, not the release day. The date filters bound the release date.",
    inputSchema: t.Object({
      currency: CURRENCY,
      indicator: t.Optional(
        t.String({ description: "Only this indicator slug" }),
      ),
      ...DATE_RANGE,
    }),
    async execute(input, ctx) {
      const p = input as Answer;
      const currency = currencyCode(p.currency);
      const query = {
        ...dateRange(p),
        indicator:
          p.indicator === undefined ? undefined : indicatorSlug(p.indicator),
      };
      const answer = await getAnswer(ctx, `calendar/${currency}`, query);
      rowsOf(answer);
      return answer;
    },
  });

  rl.registerAction("catalogue.get", {
    access: "read",
    description:
      "Every indicator served for one currency, keyed by slug, with name, unit and frequency. Works for every currency without a key.",
    inputSchema: t.Object({
      currency: CURRENCY,
      indicator: t.Optional(
        t.String({ description: "Only this indicator slug" }),
      ),
      includeCoverage: t.Optional(
        t.Boolean({ description: "Add coverage and freshness details" }),
      ),
    }),
    async execute(input, ctx) {
      const p = input as Answer;
      const currency = currencyCode(p.currency);
      return getAnswer(ctx, `data_catalogue/${currency}`, {
        indicator:
          p.indicator === undefined ? undefined : indicatorSlug(p.indicator),
        include_coverage: p.includeCoverage === true ? true : undefined,
      });
    },
  });

  rl.registerAction("forex.list", {
    access: "read",
    description:
      "Daily FX spot rates for a currency pair, most recent first. Needs an API key.",
    inputSchema: t.Object({
      base: t.String({ description: "Base currency code, e.g. EUR" }),
      quote: t.String({ description: "Quote currency code, e.g. USD" }),
      ...DATE_RANGE,
      ...PAGING,
    }),
    async execute(input, ctx) {
      const p = input as Answer;
      const base = currencyCode(p.base, "base");
      const quote = currencyCode(p.quote, "quote");
      return pagedRows(ctx, `forex/${base}/${quote}`, dateRange(p), p);
    },
  });
}
