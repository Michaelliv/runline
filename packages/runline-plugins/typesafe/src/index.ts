import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { GUIDE, GUIDE_TOPICS, type GuideTopic } from "./guide.js";
import {
  choiceRubric,
  noulRubric,
  type Question,
  questionsSchema,
  scoreRubric,
  toWireQuestion,
  toWireQuestions,
} from "./questions.js";
import {
  DEFAULT_BASE,
  DEFAULT_MODEL,
  evaluate,
  modelSchema,
  request,
  resolveModel,
  STRICT,
  stateSchema,
  type WireQuestion,
} from "./shared.js";

/**
 * TypeSafe AI's Jev — a System One model — as runline actions.
 *
 * Jev does not generate text. You send a state plus typed questions and it
 * returns values your code branches on, with calibrated probabilities and
 * confidence, in 70-500ms for $0.042 per million input tokens (output free).
 * Every question in a request is evaluated in parallel against the same
 * state, so batching is nearly free.
 *
 * Auth: a TypeSafe API key (bearer), env TYPESAFE_API_KEY.
 *
 *   await typesafe.noul({ state: ticket, instructions: "Does this request a refund?" })
 *   await typesafe.evaluate({ state: ticket, questions: [...] })
 *   await typesafe.guide({ topic: "jaggedness" })
 */

const SUMMARY =
  "Jev (TypeSafe System One) returns typed decisions with calibrated probabilities instead of text — ~70-500ms and a " +
  "fraction of a cent, versus a full LLM turn.";

const USE_WHEN =
  "Reach for it whenever a bounded decision is currently costing an LLM turn: intent routing, classification, ranking " +
  "without embeddings, relevance filtering, screening before a tool call. Not for generation, arithmetic, counting, or " +
  "date comparison — read typesafe.guide first if you have not.";

export default function typesafe(rl: RunlinePluginAPI): void {
  rl.setName("typesafe");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema(
    t.Object({
      apiKey: t.String({
        env: "TYPESAFE_API_KEY",
        description:
          "TypeSafe API key, sent as a bearer token. Mint one at https://console.typesafe.ai/settings/keys. Store only in secrets.",
      }),
      model: t.Optional(
        t.String({
          env: "TYPESAFE_MODEL",
          default: DEFAULT_MODEL,
          description:
            "Default model for every call. 'jev-latest' (stable) or 'jev-preview', or pin a version such as 'jev-1.13.0' when thresholds are tuned against it.",
        }),
      ),
      baseUrl: t.Optional(
        t.String({
          env: "TYPESAFE_API_BASE",
          default: DEFAULT_BASE,
          description: "TypeSafe API base URL.",
        }),
      ),
      maxRetries: t.Optional(
        t.Integer({
          minimum: 0,
          maximum: 5,
          default: 2,
          description:
            "Retries with exponential backoff on 429 and on any 5xx, honouring retry-after. Every action here is a pure read, so a retry can never double an effect. A 4xx other than 429 is your bug and never retries.",
        }),
      ),
    }),
  );

  /* ---------------------------------------------------------------- */
  /* The primary call                                                 */
  /* ---------------------------------------------------------------- */

  rl.registerAction("evaluate", {
    access: "read",
    description:
      `Ask many typed questions about one state in a single parallel call. ${SUMMARY} ` +
      "Returns one answer per question id, each carrying its full probability distribution and confidence — nothing is " +
      `flattened to a verdict, so your code decides what to act on and what to escalate. ${USE_WHEN}`,
    inputSchema: t.Object(
      {
        state: stateSchema,
        questions: questionsSchema,
        model: t.Optional(modelSchema),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const { state, questions, model } = input as {
        state: unknown;
        questions: Question[];
        model?: string;
      };
      const response = await evaluate(
        ctx,
        state,
        toWireQuestions(questions),
        resolveModel(ctx, model),
      );
      return {
        model: response.model,
        answers: response.answers,
        usage: response.usage,
      };
    },
  });

  /* ---------------------------------------------------------------- */
  /* Single-question shorthands                                       */
  /* ---------------------------------------------------------------- */

  const single = (
    name: "choice" | "score" | "noul",
    description: string,
    rubric: Record<string, t.TSchema>,
  ) => {
    rl.registerAction(name, {
      access: "read",
      description,
      inputSchema: t.Object(
        {
          state: stateSchema,
          ...rubric,
          model: t.Optional(modelSchema),
        },
        STRICT,
      ),
      async execute(input, ctx) {
        const { state, model, ...rest } = input as Record<string, unknown>;
        // The rubric fields are this primitive's own, validated against the
        // schema before execute runs; the id names the lone question.
        const question = toWireQuestion({
          ...rest,
          id: name,
          type: name,
        } as Question);
        const response = await evaluate(
          ctx,
          state,
          { [name]: question },
          resolveModel(ctx, model),
        );
        const answer = response.answers[name];
        if (!answer) throw new Error(`TypeSafe returned no ${name} answer.`);
        return { ...answer, model: response.model, usage: response.usage };
      },
    });
  };

  single(
    "choice",
    "Pick one option from a declared set, with the probability of every option and a confidence score. " +
      `${SUMMARY} Shorthand for a one-question evaluate — when you need more than one judgment about the same state, ` +
      "use typesafe.evaluate instead: questions run in parallel, so a second question costs tokens but barely any " +
      "latency, while a second call costs a whole round trip.",
    choiceRubric,
  );

  single(
    "score",
    "Rate the state against an ordered rubric, returning a probability-weighted score, the per-level distribution, and confidence. " +
      `${SUMMARY} Shorthand for a one-question evaluate; batch through typesafe.evaluate when you have several judgments to make.`,
    scoreRubric,
  );

  single(
    "noul",
    "Evaluate one yes/no statement, returning the probability it is true (0 to 1). The cheapest primitive: a relevance " +
      `filter, a guardrail check, a presence test. ${SUMMARY} Shorthand for a one-question evaluate; to test a list of ` +
      "items, ask one noul per item through typesafe.evaluate in a single call and combine the results in code.",
    noulRubric,
  );

  /* ---------------------------------------------------------------- */
  /* Escape hatch and metadata                                        */
  /* ---------------------------------------------------------------- */

  rl.registerAction("raw", {
    access: "read",
    description:
      "POST a literal TypeSafe request body to /v1/systemone, unmodified. Reach for it only when the typed actions cannot " +
      "express the shape: structured criteria, or a question type added to the API after this plugin. Structured " +
      "instructions need no escape hatch — typesafe.evaluate accepts them. Prefer evaluate: it validates before you spend.",
    inputSchema: t.Object(
      {
        state: stateSchema,
        questions: t.Record(t.String(), t.Unknown(), {
          minProperties: 1,
          description:
            "The wire-format questions map: your question id -> { type: 'choice' | 'score' | 'noul', instructions, criteria }. " +
            "criteria is an option->description map for choice, an ordered array of level descriptions for score, and " +
            "{ true, false } for noul. Answers return under the same ids.",
        }),
        model: t.Optional(modelSchema),
      },
      STRICT,
    ),
    async execute(input, ctx) {
      const { state, questions, model } = input as {
        state: unknown;
        questions: Record<string, WireQuestion>;
        model?: string;
      };
      return evaluate(ctx, state, questions, resolveModel(ctx, model));
    },
  });

  rl.registerAction("model.list", {
    access: "read",
    description:
      "List the models and aliases this account may send in `model`, each with a description and release date. " +
      "Versioned ids such as 'jev-1.13.0' are accepted whether or not they appear here.",
    inputSchema: t.Object({}, STRICT),
    async execute(_input, ctx) {
      const body = await request<{ models?: unknown[] }>(ctx, "/v1/models");
      if (!Array.isArray(body.models)) {
        throw new Error("TypeSafe returned a response with no models list.");
      }
      return body.models;
    },
  });

  rl.registerAction("guide", {
    access: "read",
    description:
      "How to write questions that work, offline and free — no API key or network call. Read this before your first " +
      "evaluate: it covers question design, the confidence bands and how to set thresholds by blast radius, the eight " +
      "known failure modes of jev-1.13 (literal reading, counting, dates, prompt injection...), the architectural " +
      "patterns, and the hard limits. Most bad results are a question-design problem this answers. It is a condensed " +
      "snapshot of TypeSafe's docs and official agent skill, taken 2026-09-16 against jev-1.13 — topic 'sources' carries " +
      "the links to both, and the live docs win wherever they disagree with this.",
    inputSchema: t.Object(
      {
        topic: t.Optional(
          t.Union(
            GUIDE_TOPICS.map((topic) => t.Literal(topic)) as [
              ReturnType<typeof t.Literal>,
              ReturnType<typeof t.Literal>,
            ],
            {
              description:
                "design (atomic questions, which primitive to use) | confidence (bands, thresholds by risk) | " +
                "jaggedness (what jev-1.13 gets wrong and what to do instead) | patterns (fan-out, confidence-gated " +
                "routing, composite scoring, intent routing, cascade) | cookbooks (worked examples) | limits (context, " +
                "rate, price, accuracy) | sources (live docs index, the .md convention, TypeSafe's official agent skill, " +
                "and how far to trust this snapshot). Omit for all of it — it is small.",
            },
          ),
        ),
      },
      STRICT,
    ),
    async execute(input) {
      const { topic } = (input ?? {}) as { topic?: GuideTopic };
      return topic ? { topic, ...(GUIDE[topic] as object) } : GUIDE;
    },
  });
}
