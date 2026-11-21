import * as t from "typebox";
import { STRICT, type WireQuestion } from "./shared.js";

/**
 * The three question primitives, as schemas an agent can read through
 * `actions.describe` and as the wire shape the API expects.
 *
 * The wire format keys questions by an id in a map and calls the option
 * rubric `criteria` in all three types, which describe() cannot walk into
 * (a free-form map has no declared properties). So the plugin takes an
 * array of typed questions carrying their own id, and each primitive names
 * its rubric after what that rubric actually is — `options`, `levels`,
 * `whenTrue`/`whenFalse`. Conversion to the wire shape happens here.
 * `typesafe.raw` remains available for the literal API body.
 */

const ATOMIC =
  "One narrow, coherent judgment, carrying its full meaning on its own — the question id is never sent to the model. " +
  "Jev is literal: it answers the words you wrote, not the intent behind them, and scoping words, negations, and implied " +
  "conditions are read at face value. State the exact condition, and reference nested state by backticked path, e.g. " +
  "`ticket.messages[0].text`. Split independently useful dimensions into separate questions and combine them in code — " +
  "but do not split apart a relationship you are asking about, and do not mistake atomic for trivial: a bounded action " +
  "selection or a contextual interpretation is one judgment, not several. A plain string carries a simple question; pass " +
  "an object or array when definitions, contrasts, exclusions, or examples make the judgment clearer.";

const idSchema = t.String({
  minLength: 1,
  maxLength: 128,
  pattern: "\\S",
  description:
    "Your key for this question. The answer comes back under the same key. Never sent to the model, so it costs nothing and does not influence inference — name it for your code.",
});

/**
 * Instructions carry structure as readily as prose. The branches stay
 * description-free, so the guidance lives once on the union and no branch
 * can contradict it as the shapes drift apart.
 */
const instructionsSchema = t.Union(
  [
    t.String({ minLength: 1, maxLength: 8_000 }),
    t.Record(t.String(), t.Unknown()),
    t.Array(t.Unknown()),
  ],
  { description: ATOMIC },
);

/**
 * Each primitive's rubric, shared by two surfaces: the question objects
 * `typesafe.evaluate` takes, and the flat input of the single-question
 * shorthands, which carry no id and imply their own type.
 */
export const choiceRubric = {
  instructions: instructionsSchema,
  options: t.Array(
    t.Object(
      {
        value: t.String({
          minLength: 1,
          maxLength: 256,
          description:
            "The option your code branches on. Returned verbatim as `choice` and as a key in `probabilities`.",
        }),
        description: t.Optional(
          t.String({
            maxLength: 2_000,
            description:
              "What this option means, and which boundary cases belong in it. Treat it as an extension of the instruction: options that argue against the instruction, or overlap each other, lose accuracy.",
          }),
        ),
      },
      STRICT,
    ),
    {
      minItems: 2,
      maxItems: 255,
      description:
        "The closed set of answers, mutually exclusive and jointly covering the state. Include a no-match outcome when " +
        "nothing may fit — an escape hatch the model can choose beats inferring one from low confidence — or ask a " +
        "separate presence Noul when that check is useful on its own. If several labels can be true at once, this is not " +
        "a Choice: ask one Noul per label. When the options are values pulled from a source, check candidate coverage " +
        "first — the model cannot choose a value you did not include. Cardinality is capped at 255; past roughly a dozen " +
        "options the model runs a slower two-stage score-then-choose pass, so latency climbs.",
    },
  ),
} as const;

export const scoreRubric = {
  instructions: instructionsSchema,
  levels: t.Array(
    t.String({
      minLength: 1,
      maxLength: 2_000,
      description:
        "A concrete situation this level describes, standing on its own without reference to the neighbouring levels — " +
        "e.g. 'Calm, just stating facts'. Index 0 is the low end.",
    }),
    {
      minItems: 2,
      maxItems: 20,
      description:
        "Ordered level descriptions, ascending, at least two. The returned score is the probability-weighted position " +
        "across them, so 1.6 means the mass sits between levels 1 and 2. Threshold on that value freely, but do not " +
        "interpolate a real-world magnitude out of it — level calibration is weak numerically. " +
        "Levels can also be the actions you will take (merge / leave / escalate), which removes the threshold entirely.",
    },
  ),
} as const;

export const noulRubric = {
  instructions: instructionsSchema,
  whenTrue: t.Optional(
    t.String({
      maxLength: 2_000,
      description:
        "What a yes (value near 1) means. Keep it aligned with the instruction: a noul whose true maps to 'no' performs measurably worse.",
    }),
  ),
  whenFalse: t.Optional(
    t.String({
      maxLength: 2_000,
      description: "What a no (value near 0) means.",
    }),
  ),
} as const;

const choiceQuestionSchema = t.Object(
  {
    id: idSchema,
    type: t.Literal("choice", {
      description:
        "Pick exactly one option. Answer: choice (highest-probability option), probabilities (every option, summing to 1), " +
        "confidence. The distribution weighs the options you declared against each other, not against anything outside the set.",
    }),
    ...choiceRubric,
  },
  STRICT,
);

const scoreQuestionSchema = t.Object(
  {
    id: idSchema,
    type: t.Literal("score", {
      description:
        "Rate the state along an ordered rubric. Answer: score (probability-weighted, may land between levels), legend, " +
        "probabilities per level, confidence. Comparable per-item Scores are how you rank a list by degree.",
    }),
    ...scoreRubric,
  },
  STRICT,
);

const noulQuestionSchema = t.Object(
  {
    id: idSchema,
    type: t.Literal("noul", {
      description:
        "Is this statement true? Answer: noul, a probability from 0 (no) to 1 (yes), with no separate confidence field — " +
        "the probability is the uncertainty. 0.5 means yes and no are equally likely; it is not a medium-intensity " +
        "reading, so use a Score when you want degree. One Noul per label is the right shape when several labels may apply.",
    }),
    ...noulRubric,
  },
  STRICT,
);

const questionSchema = t.Union(
  [choiceQuestionSchema, scoreQuestionSchema, noulQuestionSchema],
  {
    description:
      "One typed question: choice (pick one), score (rate on a rubric), or noul (is this true). " +
      "Set `type` and supply that type's rubric — options, levels, or whenTrue/whenFalse.",
  },
);

export const questionsSchema = t.Array(questionSchema, {
  minItems: 1,
  maxItems: 255,
  description:
    "Every question to ask about this state. They are evaluated in parallel and in isolation against the same state in one " +
    "pass, and cannot see each other's answers, so ten questions cost barely more wall-clock time than one and no question " +
    "pollutes another's context. Batch every question you might need, including speculative ones — but state each " +
    "speculative premise explicitly in its own instructions, and note that extra questions are near-free in latency, not " +
    "in tokens: every question's text is billed as input. A second request is the right call when an answer here decides " +
    "what evidence to fetch, what state to build, or what the next options are. Types mix freely. Ids must be unique.",
});

/** Prose, or structure when contrasts and examples sharpen the judgment. */
type Instructions = string | Record<string, unknown> | unknown[];

type ChoiceQuestion = {
  id: string;
  type: "choice";
  instructions: Instructions;
  options: Array<{ value: string; description?: string }>;
};
type ScoreQuestion = {
  id: string;
  type: "score";
  instructions: Instructions;
  levels: string[];
};
type NoulQuestion = {
  id: string;
  type: "noul";
  instructions: Instructions;
  whenTrue?: string;
  whenFalse?: string;
};

export type Question = ChoiceQuestion | ScoreQuestion | NoulQuestion;

/**
 * Ids and option values are caller-chosen strings, so every map keyed by
 * them is built through a Map and materialized with `Object.fromEntries`.
 * A plain object would report `toString` as a duplicate it never saw and
 * would drop `__proto__` on assignment, silently shrinking the request.
 */
export function toWireQuestion(question: Question): WireQuestion {
  if (question.type === "choice") {
    const criteria = new Map<string, string | null>();
    for (const option of question.options) {
      if (criteria.has(option.value)) {
        throw new Error(
          `Question "${question.id}" repeats the option "${option.value}".`,
        );
      }
      criteria.set(option.value, option.description ?? null);
    }
    return {
      type: "choice",
      instructions: question.instructions,
      criteria: Object.fromEntries(criteria),
    };
  }
  if (question.type === "score") {
    return {
      type: "score",
      instructions: question.instructions,
      criteria: question.levels,
    };
  }
  const criteria: Record<string, string> = {};
  if (question.whenTrue !== undefined) criteria.true = question.whenTrue;
  if (question.whenFalse !== undefined) criteria.false = question.whenFalse;
  return {
    type: "noul",
    instructions: question.instructions,
    ...(Object.keys(criteria).length ? { criteria } : {}),
  };
}

export function toWireQuestions(
  questions: Question[],
): Record<string, WireQuestion> {
  const wire = new Map<string, WireQuestion>();
  for (const question of questions) {
    if (wire.has(question.id)) {
      throw new Error(`Duplicate question id: "${question.id}".`);
    }
    wire.set(question.id, toWireQuestion(question));
  }
  return Object.fromEntries(wire);
}
