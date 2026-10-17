import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import fxmacrodata from "../../../runline-plugins/fxmacrodata/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import type { ActionContext } from "../plugin/types.js";
import { getAction, stubFetch } from "./helpers/plugin.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Seen = { url: string; key: string | null };

function action(name: string) {
  const { api, resolve } = createPluginAPI("fxmacrodata");
  fxmacrodata(api);
  return getAction(resolve(), name);
}

function context(config: Record<string, unknown> = {}): ActionContext {
  return {
    connection: { name: "fx", plugin: "fxmacrodata", config },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
}

/** Answers each request in turn with the next response, recording it. */
function wire(...responses: Array<() => Response>): Seen[] {
  const seen: Seen[] = [];
  stubFetch(async (url, init) => {
    seen.push({
      url: String(url),
      key: new Headers(init?.headers).get("x-api-key"),
    });
    const next = responses[Math.min(seen.length, responses.length) - 1];
    return next();
  });
  return seen;
}

const BASE = "https://api.fxmacrodata.com/v1";

describe("fxmacrodata without a key", () => {
  it("reads USD releases unsigned and surfaces the free-tier notices", async () => {
    const seen = wire(() =>
      Response.json({
        currency: "USD",
        data: [{ indicator: "inflation", val: 3.4 }],
        freemium_delay: { applied: true, message: "Delayed by 15 minutes." },
      }),
    );
    const result = (await action("announcement.latest").execute(
      { currency: "USD" },
      context(),
    )) as Record<string, unknown>;
    assert.deepEqual(seen, [
      { url: `${BASE}/announcements/usd/latest`, key: null },
    ]);
    assert.deepEqual(result.notices, ["Delayed by 15 minutes."]);
  });

  it("points a refused request at a key without reading the body", async () => {
    wire(
      () =>
        new Response('{"detail":"private-provider-detail"}', { status: 401 }),
    );
    await assert.rejects(
      Promise.resolve(
        action("forex.list").execute({ base: "EUR", quote: "USD" }, context()),
      ),
      (error: Error) =>
        /HTTP 401/.test(error.message) &&
        /needs an API key/.test(error.message) &&
        !error.message.includes("private-provider-detail"),
    );
  });
});

describe("fxmacrodata with a key", () => {
  it("sends it as X-API-Key, with the history query", async () => {
    const seen = wire(() =>
      Response.json({
        data: [{ date: "2026-08-31" }],
        pagination: { has_more: false },
      }),
    );
    await action("announcement.list").execute(
      {
        currency: "eur",
        indicator: " policy_rate ",
        startDate: "2026-01-01",
        endDate: "2026-06-30",
        limit: 100,
      },
      context({ apiKey: "test-key" }),
    );
    assert.deepEqual(seen, [
      {
        url: `${BASE}/announcements/eur/policy_rate?start_date=2026-01-01&end_date=2026-06-30&limit=100&offset=0`,
        key: "test-key",
      },
    ]);
  });

  it("scrubs the key from an answer that echoes it", async () => {
    wire(() => Response.json({ data: [], note: "key test-key accepted" }));
    const result = (await action("announcement.latest").execute(
      { currency: "USD" },
      context({ apiKey: "test-key" }),
    )) as Record<string, unknown>;
    assert.ok(!JSON.stringify(result).includes("test-key"));
  });

  it("refuses a key with a line break, before any request, without echoing it", async () => {
    const seen = wire(() => Response.json({ data: [] }));
    await assert.rejects(
      Promise.resolve(
        action("announcement.latest").execute(
          { currency: "USD" },
          context({ apiKey: "test\nkey" }),
        ),
      ),
      (error: Error) => !String(error.message).includes("test\nkey"),
    );
    assert.equal(seen.length, 0);
  });

  it("refuses a redirect rather than following it with the key", async () => {
    const seen = wire(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://elsewhere.example/" },
        }),
    );
    await assert.rejects(
      Promise.resolve(
        action("catalogue.get").execute(
          { currency: "USD" },
          context({ apiKey: "test-key" }),
        ),
      ),
    );
    assert.equal(seen.length, 1);
  });
});

describe("fxmacrodata pagination", () => {
  const page = (rows: number[], more: boolean, next?: number) => () =>
    Response.json({
      data: rows.map((val) => ({ val })),
      pagination: { has_more: more, next_offset: next },
    });

  it("follows next_offset to the last page when asked", async () => {
    const seen = wire(page([1, 2], true, 2), page([3], false));
    const result = (await action("forex.list").execute(
      { base: "EUR", quote: "USD", limit: 2, all: true },
      context({ apiKey: "test-key" }),
    )) as Record<string, unknown>;
    assert.deepEqual(
      seen.map((s) => new URL(s.url).searchParams.get("offset")),
      ["0", "2"],
    );
    assert.deepEqual(result.data, [{ val: 1 }, { val: 2 }, { val: 3 }]);
    assert.equal(result.nextOffset, null);
  });

  it("reads one page by default and says where the next begins", async () => {
    const seen = wire(page([1, 2], true, 2));
    const result = (await action("forex.list").execute(
      { base: "EUR", quote: "USD", limit: 2 },
      context({ apiKey: "test-key" }),
    )) as Record<string, unknown>;
    assert.equal(seen.length, 1);
    assert.equal(result.nextOffset, 2);
  });

  it("stops after the page cap and reports the offset to resume from", async () => {
    let offset = 0;
    const seen = wire(() => {
      offset += 1;
      return Response.json({
        data: [{ val: offset }],
        pagination: { has_more: true, next_offset: offset },
      });
    });
    const result = (await action("forex.list").execute(
      { base: "EUR", quote: "USD", limit: 1, all: true },
      context({ apiKey: "test-key" }),
    )) as Record<string, unknown>;
    assert.equal(seen.length, 50);
    assert.equal(result.nextOffset, 50);
  });

  for (const [name, pagination] of [
    ["a next_offset that does not advance", { has_more: true, next_offset: 0 }],
    ["a missing next_offset", { has_more: true }],
    [
      "a next_offset outside the safe integer range",
      { has_more: true, next_offset: Number.MAX_SAFE_INTEGER + 1 },
    ],
    ["a missing has_more", {}],
    ["a null has_more", { has_more: null }],
    ["a has_more that is not a boolean", { has_more: "yes" }],
    ["a pagination that is not an object", [1]],
  ] as const)
    it(`refuses ${name}`, async () => {
      wire(() => Response.json({ data: [], pagination }));
      await assert.rejects(
        Promise.resolve(
          action("announcement.list").execute(
            { currency: "USD", indicator: "inflation", all: true },
            context(),
          ),
        ),
        /unexpected response/,
      );
    });
});

describe("fxmacrodata answers", () => {
  for (const [name, respond] of [
    [
      "an error body on a 200",
      () =>
        Response.json({ error: "api_key_required", detail: "Needs a key." }),
    ],
    ["a body that is not JSON", () => new Response("<html>")],
    ["a JSON list", () => Response.json([1, 2])],
    ["data that is not a list", () => Response.json({ data: { a: 1 } })],
  ] as const)
    it(`refuses ${name} cleanly`, async () => {
      wire(respond);
      await assert.rejects(
        Promise.resolve(
          action("calendar.list").execute({ currency: "USD" }, context()),
        ),
        (error: unknown) => error instanceof Error && error.message.length > 0,
      );
    });

  it("passes calendar filters through", async () => {
    const seen = wire(() => Response.json({ data: [] }));
    await action("calendar.list").execute(
      {
        currency: "USD",
        indicator: "non_farm_payrolls",
        startDate: "2026-10-01",
      },
      context(),
    );
    assert.equal(
      seen[0].url,
      `${BASE}/calendar/usd?start_date=2026-10-01&indicator=non_farm_payrolls`,
    );
  });
});

describe("fxmacrodata input", () => {
  for (const [name, actionName, input] of [
    ["a currency that is not 3 letters", "catalogue.get", { currency: "US" }],
    [
      "a date that does not exist",
      "announcement.list",
      { currency: "USD", indicator: "inflation", startDate: "2026-02-30" },
    ],
    [
      "a start after the end",
      "forex.list",
      {
        base: "EUR",
        quote: "USD",
        startDate: "2026-06-01",
        endDate: "2026-01-01",
      },
    ],
    [
      "a limit above 100",
      "announcement.list",
      { currency: "USD", indicator: "inflation", limit: 101 },
    ],
    [
      "a blank indicator",
      "announcement.list",
      { currency: "USD", indicator: "  " },
    ],
    [
      "an indicator that is a path",
      "announcement.list",
      { currency: "USD", indicator: "../latest" },
    ],
  ] as const)
    it(`refuses ${name} before any request`, async () => {
      const seen = wire(() => Response.json({ data: [] }));
      await assert.rejects(
        Promise.resolve(
          action(actionName).execute(
            input as Record<string, unknown>,
            context(),
          ),
        ),
        /invalid/,
      );
      assert.equal(seen.length, 0);
    });
});
