import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import typesafe from "../../../runline-plugins/typesafe/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import { helpInputs } from "../plugin/schema.js";
import type { ActionContext, PluginDef } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function build(): PluginDef {
  const { api, resolve } = createPluginAPI("typesafe");
  typesafe(api);
  return resolve();
}

const plugin = build();

function action(name: string) {
  const found = plugin.actions.find((a) => a.name === name);
  assert.ok(found, `expected typesafe.${name} to be registered`);
  return found;
}

function ctx(config: Record<string, unknown> = {}): ActionContext {
  return {
    connection: {
      name: "test",
      plugin: "typesafe",
      config: { apiKey: "ts-test", maxRetries: 0, ...config },
    },
    log: { info() {}, warn() {}, error() {} },
    async updateConnection() {},
  };
}

interface Seen {
  url: string;
  auth: string | null;
  body: {
    state?: unknown;
    model?: string;
    questions?: Record<string, Record<string, unknown>>;
  };
}

function mock(payload: unknown, status = 200): { calls: Seen[] } {
  const calls: Seen[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      auth: new Headers(init?.headers).get("authorization"),
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls };
}

const ANSWERS = {
  model: "jev-1.13.0",
  answers: {
    department: {
      type: "choice",
      choice: "technical",
      probabilities: { billing: 0.08, technical: 0.85, sales: 0.07 },
      confidence: 0.82,
    },
    frustration: {
      type: "score",
      score: 1.6,
      legend: { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
      probabilities: { "0": 0.05, "1": 0.3, "2": 0.65 },
      confidence: 0.78,
    },
    is_urgent: { type: "noul", noul: 0.92 },
  },
  usage: { input_tokens: 312, output_tokens: 48 },
};

/** What a one-question `typesafe.noul` call gets back: keyed by the action name. */
const NOUL_ANSWER = {
  model: "jev-1.13.0",
  answers: { noul: { type: "noul", noul: 0.92 } },
  usage: { input_tokens: 12, output_tokens: 3 },
};

describe("typesafe plugin surface", () => {
  it("registers seven read-only actions and an env-backed API key", () => {
    assert.equal(plugin.name, "typesafe");
    assert.deepEqual(plugin.actions.map((a) => a.name).sort(), [
      "choice",
      "evaluate",
      "guide",
      "model.list",
      "noul",
      "raw",
      "score",
    ]);
    assert.ok(plugin.actions.every((a) => a.access === "read"));
    assert.ok(plugin.actions.every((a) => (a.description?.length ?? 0) > 80));
    const connection = plugin.connectionConfigSchema as {
      properties: Record<string, { env?: string }>;
      required: string[];
    };
    assert.equal(connection.properties.apiKey.env, "TYPESAFE_API_KEY");
    assert.deepEqual(connection.required, ["apiKey"]);
  });

  it("documents the question primitives through describe, one level down", () => {
    const inputs = helpInputs(action("evaluate").inputSchema);
    const variants = inputs.questions.items?.variants;
    assert.equal(variants?.length, 3);
    assert.deepEqual(
      variants?.map((v) => v.properties?.type.const),
      ["choice", "score", "noul"],
    );
    // The rubric of each primitive, and the element shape inside it, carry
    // their own guidance — describe is the plugin's documentation.
    const choice = variants?.[0];
    assert.match(String(choice?.properties?.options.description), /255/);
    assert.match(
      String(choice?.properties?.options.items?.properties?.value.description),
      /probabilities/,
    );
    assert.match(
      String(variants?.[1].properties?.levels.description),
      /probability-weighted/,
    );
    assert.match(String(inputs.state.description), /64k tokens/);

    // Instructions accept all three shapes the API takes, and the guidance
    // sits once on the union so no branch can contradict it.
    const instructions = variants?.[2].properties?.instructions;
    assert.equal(instructions?.displayType, "string | object | array");
    assert.match(String(instructions?.description), /definitions, contrasts/);
    assert.deepEqual(
      instructions?.variants?.map((v) => v.description),
      [undefined, undefined, undefined],
    );
  });

  it("accepts structured instructions through the typed path", async () => {
    const { calls } = mock(NOUL_ANSWER);
    const instructions = {
      claim: "a refund was issued",
      excludes: ["a refund that was only promised"],
    };
    await action("noul").execute({ state: "s", instructions }, ctx());
    assert.deepEqual(calls[0].body.questions?.noul.instructions, instructions);
  });

  it("rejects malformed questions before any request", async () => {
    globalThis.fetch = (async () => {
      throw new Error("must not call the API");
    }) as typeof fetch;
    const invalid: Array<[string, unknown]> = [
      ["evaluate", { state: "s", questions: [] }],
      ["evaluate", { state: "s", questions: [{ id: "a", type: "choice" }] }],
      [
        "evaluate",
        {
          state: "s",
          questions: [
            {
              id: "a",
              type: "choice",
              instructions: "x",
              options: [{ value: "only" }],
            },
          ],
        },
      ],
      [
        "evaluate",
        {
          state: "s",
          questions: [
            { id: "a", type: "score", instructions: "x", levels: ["only"] },
          ],
        },
      ],
      [
        "evaluate",
        {
          state: "s",
          questions: [{ id: "a", type: "noul", instructions: "x" }],
          extra: true,
        },
      ],
      ["noul", { state: "s" }],
      ["raw", { state: "s", questions: {} }],
      ["guide", { topic: "invented" }],
    ];
    for (const [name, input] of invalid) {
      assert.equal(
        Check(action(name).inputSchema as TSchema, input),
        false,
        `${name} should reject ${JSON.stringify(input)}`,
      );
    }
  });

  it("translates typed questions into the wire body and returns answers intact", async () => {
    const { calls } = mock(ANSWERS);
    const result = (await action("evaluate").execute(
      {
        state: { ticket: "payouts failing for 3 days" },
        questions: [
          {
            id: "department",
            type: "choice",
            instructions: "Which team should handle this?",
            options: [
              { value: "billing", description: "Payments, invoicing, refunds" },
              { value: "technical" },
            ],
          },
          {
            id: "frustration",
            type: "score",
            instructions: "How frustrated is the customer?",
            levels: ["Calm", "Frustrated", "Very angry"],
          },
          {
            id: "is_urgent",
            type: "noul",
            instructions: "Does this convey urgency?",
            whenTrue: "Explicitly time-sensitive",
          },
        ],
      },
      ctx(),
    )) as { model: string; answers: Record<string, unknown>; usage: unknown };

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(calls[0].auth, "Bearer ts-test");
    assert.equal(calls[0].body.model, "jev-latest");
    assert.deepEqual(calls[0].body.questions?.department, {
      type: "choice",
      instructions: "Which team should handle this?",
      criteria: { billing: "Payments, invoicing, refunds", technical: null },
    });
    assert.deepEqual(calls[0].body.questions?.frustration?.criteria, [
      "Calm",
      "Frustrated",
      "Very angry",
    ]);
    assert.deepEqual(calls[0].body.questions?.is_urgent, {
      type: "noul",
      instructions: "Does this convey urgency?",
      criteria: { true: "Explicitly time-sensitive" },
    });

    // Probabilities and confidence survive: nothing is flattened to a verdict.
    assert.deepEqual(result.answers, ANSWERS.answers);
    assert.equal(result.model, "jev-1.13.0");
    assert.deepEqual(result.usage, ANSWERS.usage);
  });

  it("prefers the per-call model, then the connection default", async () => {
    const { calls } = mock(NOUL_ANSWER);
    const question = {
      state: "s",
      instructions: "Does this convey urgency?",
    };
    await action("noul").execute({ ...question, model: "jev-1.13.0" }, ctx());
    await action("noul").execute(question, ctx({ model: "jev-preview" }));
    await action("noul").execute(question, ctx());
    assert.deepEqual(
      calls.map((c) => c.body.model),
      ["jev-1.13.0", "jev-preview", "jev-latest"],
    );
  });

  it("returns the single answer flat from the shorthands", async () => {
    mock({
      model: "jev-1.13.0",
      answers: { noul: { type: "noul", noul: 0.999 } },
      usage: { input_tokens: 12, output_tokens: 3 },
    });
    const result = (await action("noul").execute(
      { state: "Help! My payouts have been failing.", instructions: "Urgent?" },
      ctx(),
    )) as Record<string, unknown>;
    assert.equal(result.noul, 0.999);
    assert.equal(result.type, "noul");
    assert.equal(result.model, "jev-1.13.0");
  });

  it("rejects duplicate ids and duplicate options locally", async () => {
    const { calls } = mock(ANSWERS);
    const duplicateId = {
      state: "s",
      questions: [
        { id: "a", type: "noul", instructions: "x" },
        { id: "a", type: "noul", instructions: "y" },
      ],
    };
    await assert.rejects(
      () => action("evaluate").execute(duplicateId, ctx()) as Promise<unknown>,
      /Duplicate question id/,
    );
    await assert.rejects(
      () =>
        action("evaluate").execute(
          {
            state: "s",
            questions: [
              {
                id: "a",
                type: "choice",
                instructions: "x",
                options: [{ value: "same" }, { value: "same" }],
              },
            ],
          },
          ctx(),
        ) as Promise<unknown>,
      /repeats the option/,
    );
    assert.equal(calls.length, 0);
  });

  it("treats prototype-shaped ids and options as ordinary keys", async () => {
    const { calls } = mock({
      model: "jev-1.13.0",
      answers: { toString: { type: "choice", choice: "__proto__" } },
    });
    await action("evaluate").execute(
      {
        state: "s",
        questions: [
          {
            id: "toString",
            type: "choice",
            instructions: "Which one?",
            options: [{ value: "__proto__" }, { value: "constructor" }],
          },
        ],
      },
      ctx(),
    );
    // A plain accumulator object would have reported "toString" as a
    // duplicate and dropped "__proto__" from the criteria entirely.
    assert.deepEqual(Object.keys(calls[0].body.questions ?? {}), ["toString"]);
    assert.deepEqual(
      Object.keys((calls[0].body.questions?.toString.criteria ?? {}) as object),
      ["__proto__", "constructor"],
    );
  });

  it("refuses an oversized state instead of paying for a 422", async () => {
    const { calls } = mock(ANSWERS);
    await assert.rejects(
      () =>
        action("noul").execute(
          { state: "x".repeat(300_000), instructions: "Urgent?" },
          ctx(),
        ) as Promise<unknown>,
      /over Jev's 64000-token ceiling/,
    );
    assert.equal(calls.length, 0);
  });

  it("explains 401, 422 and 429 rather than leaking a bare status", async () => {
    for (const [status, pattern] of [
      [401, /API key was rejected/],
      [422, /failed validation/],
      [429, /rate limit exceeded/],
      [503, /model is unavailable/],
      [529, /overloaded/],
      [500, /the service failed this request/],
    ] as const) {
      mock({ detail: "server said so" }, status);
      await assert.rejects(
        () =>
          action("noul").execute(
            { state: "s", instructions: "Urgent?" },
            ctx(),
          ) as Promise<unknown>,
        pattern,
      );
    }
  });

  it("retries 429 and any 5xx, and never retries a 4xx", async () => {
    // 503 model_unavailable is undocumented but real; a pure read can
    // always be replayed, so every transient server status is retried.
    for (const status of [429, 500, 503, 529]) {
      let attempts = 0;
      globalThis.fetch = (async () => {
        attempts++;
        if (attempts === 1) {
          return new Response("{}", {
            status,
            headers: { "retry-after": "0" },
          });
        }
        return new Response(JSON.stringify(NOUL_ANSWER), { status: 200 });
      }) as typeof fetch;
      await action("noul").execute(
        { state: "s", instructions: "Urgent?" },
        ctx({ maxRetries: 2 }),
      );
      assert.equal(attempts, 2, `status ${status} should be retried once`);
    }

    let attempts = 0;
    globalThis.fetch = (async () => {
      attempts++;
      return new Response("{}", { status: 422 });
    }) as typeof fetch;
    await assert.rejects(
      () =>
        action("noul").execute(
          { state: "s", instructions: "Urgent?" },
          ctx({ maxRetries: 2 }),
        ) as Promise<unknown>,
      /422/,
    );
    assert.equal(attempts, 1);
  });

  it("passes a raw body through untouched", async () => {
    const { calls } = mock(ANSWERS);
    const questions = {
      nested: {
        type: "noul",
        instructions: { claim: "the refund was issued", scope: "this message" },
      },
    };
    await action("raw").execute({ state: "s", questions }, ctx());
    assert.deepEqual(calls[0].body.questions, questions);
  });

  it("serves the design guide offline, whole or by topic", async () => {
    globalThis.fetch = (async () => {
      throw new Error("guide must not hit the network");
    }) as typeof fetch;
    const all = (await action("guide").execute({}, ctx())) as Record<
      string,
      unknown
    >;
    assert.deepEqual(Object.keys(all), [
      "design",
      "confidence",
      "jaggedness",
      "patterns",
      "cookbooks",
      "limits",
      "sources",
    ]);
    const jagged = (await action("guide").execute(
      { topic: "jaggedness" },
      ctx(),
    )) as { topic: string; failureModes: Array<{ mode: string }> };
    assert.equal(jagged.topic, "jaggedness");
    assert.equal(jagged.failureModes.length, 8);

    // A frozen snapshot has to say so and point at what outranks it.
    const sources = (await action("guide").execute(
      { topic: "sources" },
      ctx(),
    )) as { trust: string; officialSkill: string; docsIndex: string };
    assert.match(sources.trust, /source of truth/);
    assert.match(sources.docsIndex, /docs\.typesafe\.ai\/llms\.txt/);
    assert.match(sources.officialSkill, /typesafe-ai\/skills/);
  });

  it("lists models from the metadata endpoint, and rejects a shapeless one", async () => {
    const { calls } = mock({ models: [{ name: "jev-latest" }] });
    const models = await action("model.list").execute({}, ctx());
    assert.equal(calls[0].url, "https://api.typesafe.ai/v1/models");
    assert.deepEqual(models, [{ name: "jev-latest" }]);

    mock({ unexpected: true });
    await assert.rejects(
      () => action("model.list").execute({}, ctx()) as Promise<unknown>,
      /no models list/,
    );
  });
});
