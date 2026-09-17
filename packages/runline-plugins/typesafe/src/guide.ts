/**
 * The offline half of the plugin's progressive disclosure: everything an
 * agent should know before writing questions, without a network call and
 * without pasting the whole of docs.typesafe.ai into every description.
 *
 * `typesafe.guide` serves these topics. Condensed from docs.typesafe.ai
 * (concepts, confidence, patterns, cookbooks) and the jev-1.13 jaggedness
 * page, reviewed 2026-09-16.
 */

export const GUIDE_TOPICS = [
  "design",
  "confidence",
  "jaggedness",
  "patterns",
  "cookbooks",
  "limits",
  "sources",
] as const;

export type GuideTopic = (typeof GUIDE_TOPICS)[number];

export const GUIDE: Record<GuideTopic, unknown> = {
  design: {
    model:
      "Jev is a System One model: it evaluates typed questions against a state and returns typed answers with calibrated " +
      "probabilities. It does not generate text, cannot produce a type error, and cannot invent an option you did not declare. " +
      "Typed output guarantees the interface, not the truth: calibration is a property of groups of predictions, not of " +
      "any single answer, so validate performance in your own domain.",
    shape:
      "Code stays in control of execution. The model supplies the fuzzy judgment; every branch, threshold, arithmetic step, " +
      "and side effect belongs to your code. Think of a question as a learned semantic branch instruction.",
    rules: [
      "One question, one judgment. Split independently useful dimensions — but not a relationship you are asking about, and atomic does not mean trivial: a bounded action selection is one judgment.",
      "Write literally. The model answers the words in the instruction, not the intent behind them. Name nested state by backticked path.",
      "Send the smallest state that answers the question. Unrelated detail is a distractor and costs accuracy.",
      "Batch every question about a state into one call, including speculative ones, each with its premise stated. Extra questions are near-free in latency, not in tokens.",
      "Sequence a second call only when an answer decides what evidence to fetch, what state to build, or what the next options are.",
      "Keep questions and thresholds together in one module. They are the part humans need to review.",
      "Prefer a closed set the model chooses from over asking it to produce a value. For extraction, find candidates with regex or a generative model, then have Jev pick the right one — and check candidate coverage, because it cannot choose a value you omitted.",
    ],
    choosing: {
      choice:
        "Pick one of a declared set. Routing, classification, ranking a candidate against options, function selection.",
      score:
        "Rate against an ordered rubric. Severity, frustration, relevance, quality. Levels can be the actions you will take.",
      noul: "One yes/no proposition. Guardrail checks, relevance filters, presence tests. Cheapest way to fan out over a list.",
    },
  },

  confidence: {
    definition:
      "confidence is a single number from 0 to 1 derived from the answer's own probability distribution: concentrated means " +
      "certain, flat means uncertain. Choice and Score carry it; Noul does not, because its noul value is already the probability.",
    ownMeasure:
      "The full probabilities map is always returned. If TypeSafe's confidence statistic does not fit your decision, compute " +
      "your own from the distribution — margin between top two, entropy, mass above a level.",
    bands: {
      high: "Act automatically.",
      medium:
        "Proceed with caution — confirm with the user, flag for review, or gather more state.",
      low: "Consider not acting: route to a human, ask for clarification, or fall back to another system.",
    },
    bandsAreNotALaw:
      "Confidence summarizes how concentrated the distribution is. It is not a measure of workflow correctness and not " +
      "permission to act. Several genuinely acceptable options spread probability too, so low confidence on a harmless " +
      "preference is not a problem to solve, and uncertainty on a branch you never read can be ignored outright.",
    noulIsNotIntensity:
      "A Noul near 0.5 means yes and no are about equally likely. It is not a medium-intensity reading — reach for a " +
      "Score when you want degree.",
    thresholds:
      "A threshold is not one number for the whole system. Gate each action at the level its blast radius deserves: a " +
      "read-only screen can act on a mediocre confidence, an irreversible transfer should not. Start conservative, measure " +
      "against your own labelled data and consequences, and move the numbers deliberately.",
    antipattern:
      "If all you want is the best option, take the highest-probability choice — no threshold needed. Reach for confidence " +
      "when 'should I act at all' is a real question, and for probabilities when you have a specific statistical algorithm in mind.",
  },

  jaggedness: {
    applies: "jev-1.13, reviewed 2026-09-16.",
    failureModes: [
      {
        mode: "Literal reading",
        detail:
          "Scoping words, negations, and implied conditions are taken at face value. When you look at a wrong answer and " +
          "catch yourself explaining what you really meant, that explanation is the missing half of the instruction.",
        instead:
          "Write the exact condition; put boundary cases in the option or level descriptions.",
      },
      {
        mode: "Math and numbers",
        detail:
          "Not a calculator. Counting is unreliable and the error grows with the size of the thing counted. Numeric " +
          "representations (hex colors, RGB triples, assembly) underperform their semantic equivalents.",
        instead:
          "Keep arithmetic in code. To count items matching a criterion, ask one Noul per item in a single batched call and sum the results yourself.",
      },
      {
        mode: "Date and time comparison",
        detail:
          "Dates are read as text, not as ordered quantities. Ordering, distance, and window membership are all unreliable, worse with mixed formats.",
        instead:
          "Extract the parts as Choices over closed sets (twelve months, thirty-one days) with an explicit 'not stated' option, then assemble and compare in code.",
      },
      {
        mode: "Indirection",
        detail:
          "Double negatives and properties-of-properties cost accuracy with every hop.",
        instead: "Ask directly, and name the relevant part of the state.",
      },
      {
        mode: "Large state full of irrelevant detail",
        detail:
          "Accuracy falls as unrelated content grows, and attribution of a wrong answer gets harder.",
        instead:
          "Retrieve and filter in code first. Where you cannot, use a Noul as a relevance filter before the real questions.",
      },
      {
        mode: "Adversarial content",
        detail:
          "State is treated as data, not as hostile. Injected instructions, misleading framing, and text that argues for its " +
          "own classification can move the answer. This limits how much a single Jev call can be trusted as a standalone guardrail.",
        instead:
          "Be explicit in the criteria, test edge cases before deploying, and keep a defence in depth around it.",
      },
      {
        mode: "Contradictory instructions and criteria",
        detail:
          "Criteria that pull against the instruction confuse the model — a Noul whose true means 'no' is the classic case.",
        instead:
          "Treat criteria as an extension of the instruction, phrased so an average reader would agree they match.",
      },
      {
        mode: "Generation",
        detail:
          "Not trained to generate. Chaining choices to spell out text is slow and poor.",
        instead:
          "Bound the answer space and let Jev pick; use a generative model when you genuinely need new text.",
      },
    ],
  },

  patterns: {
    speculativeFanOut:
      "Ask everything you might need about a state in one call, including questions you may never read, stating each " +
      "speculative premise explicitly in its own instructions since the questions cannot see one another. Extra questions " +
      "barely move latency, and a branch that turns out to matter already has its answer.",
    confidenceGatedRouting:
      "Two axes: the answer says what, the confidence says whether to act. Automate the confident cases, review the rest. " +
      "This is the pattern that makes the model's uncertainty a feature rather than a liability.",
    compositeScoring:
      "Break a complex judgment into atomic scores and combine them with weights your code owns. The weights stay reviewable " +
      "and tunable without retraining or reprompting anything.",
    intentRouting:
      "Classify the incoming request, then send it to the cheapest handler that can serve it: deterministic code, a specialist " +
      "LLM, or a human. The classification costs a fraction of a cent and roughly 300ms.",
    cascade:
      "Screen with Jev, escalate only what survives. A cheap first pass in front of an expensive model recovers most of the " +
      "quality at a fraction of the spend.",
  },

  cookbooks: {
    note: "Worked examples at https://docs.typesafe.ai/cookbooks — the ones closest to agent infrastructure:",
    items: [
      "rerank_typesafe — one question per query/candidate pair re-ranks a BM25 shortlist; top-1 accuracy 5% to 18%, top-10 38% to 62%.",
      "skill_suggestion — picks at most one skill from a 182-skill catalog: one call ranks them all and asks whether a skill is needed, a second reads the top three and may reject all.",
      "classifying_rag_passages — score every retrieved passage, then decide in code what reaches the answering model; drops passages carrying prompt injection.",
      "llm_guardrails — screen messages in and out with hazard questions plus a severity score, then threshold to pass, review, block, or route.",
      "function_calling — map function names and closed-set arguments to confidence-aware questions.",
      "citation_check — decide whether a quote's context supports the claim, with confidence flagging for review.",
      "semantic_find — score hundreds of line ids in one request, plus a Noul for 'is the answer here at all'.",
      "parallel_questions — 13 questions in one call: 12.2x cheaper and 10.0x faster than 13 calls, same answers.",
    ],
  },

  limits: {
    context: [
      "~64k tokens for state plus all questions together.",
      "~32k tokens for state plus the single longest question.",
      "Packing many questions into one call is the efficient use of that budget.",
    ],
    rateLimits:
      "250,000 tokens/sec and 1,200 requests/minute, adjusted dynamically by TypeSafe without notice. This plugin retries " +
      "429 and any 5xx (including the undocumented 503 model_unavailable) with backoff, honouring retry-after; " +
      "connection field maxRetries, default 2.",
    price:
      "$0.042 per million input tokens. Output tokens are free. Typical call: 70-500ms.",
    modality:
      "Text only — strings, JSON objects, arrays of text. No images, audio, or video.",
    accuracy:
      "On TypeSafe's own four-workflow benchmark Jev lands near mid-tier LLM accuracy (~68%) while being one to two orders " +
      "of magnitude cheaper and faster. Those numbers are self-reported and unreproduced; measure on your own data before " +
      "trusting a threshold.",
  },

  sources: {
    trust:
      "The live docs are the source of truth. Everything above is a condensed snapshot taken 2026-09-16 against jev-1.13: " +
      "good for orientation and for writing a first question, not authoritative. Read the docs for anything " +
      "version-dependent, any model past jev-1.13, or a cookbook you want in full rather than in one line.",
    docsIndex:
      "https://docs.typesafe.ai/llms.txt lists every page and cookbook. Read targeted pages from it rather than the site.",
    markdown:
      "Any docs page serves Markdown by appending .md to its path, e.g. https://docs.typesafe.ai/concepts/state.md. " +
      "Resolve relative links against https://docs.typesafe.ai.",
    officialSkill:
      "TypeSafe publishes an agent skill covering the same ground in more depth: " +
      "https://raw.githubusercontent.com/typesafe-ai/skills/main/skills/typesafe-ai/SKILL.md " +
      "(repo https://github.com/typesafe-ai/skills). This guide is condensed from it and from the docs. Read the skill " +
      "when you are designing a whole workflow; this guide is enough for writing one good question.",
    startHere: {
      "programming model":
        "https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md",
      "what to build": "https://docs.typesafe.ai/concepts/use-case-map.md",
      "state and questions":
        "https://docs.typesafe.ai/concepts/state.md, https://docs.typesafe.ai/primitives.md",
      uncertainty: "https://docs.typesafe.ai/confidence.md",
      "wire format": "https://docs.typesafe.ai/api.md",
      "current failure modes":
        "https://docs.typesafe.ai/model-jaggedness/jev-1.13.md",
    },
  },
};
