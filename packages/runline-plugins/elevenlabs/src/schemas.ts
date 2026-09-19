import * as t from "typebox";

export const STRICT = { additionalProperties: false } as const;
export const text = t.String({ minLength: 1, pattern: "\\S" });
export const timeout = t.Integer({
  minimum: 1000,
  maximum: 3_600_000,
  default: 300_000,
  description:
    "Request deadline including the response body; does not cancel provider work.",
});
export const fileOptions = {
  saveDir: t.Optional(text),
  timeoutMs: t.Optional(timeout),
};
export const seed = t.Integer({ minimum: 0, maximum: 4294967295 });
export const normalization = t.Union([
  t.Literal("auto"),
  t.Literal("on"),
  t.Literal("off"),
]);
export const dictionaries = t.Array(
  t.Object(
    { pronunciation_dictionary_id: text, version_id: t.Optional(text) },
    STRICT,
  ),
  { maxItems: 3 },
);
const rates = [8000, 16000, 22050, 24000, 32000, 44100, 48000];
const mp3 = [
  "mp3_22050_32",
  "mp3_24000_48",
  ...[32, 64, 96, 128, 192].map((rate) => `mp3_44100_${rate}`),
];
const compressedAndRaw = [
  ...mp3,
  ...rates.map((rate) => `pcm_${rate}`),
  ...[32, 64, 96, 128, 192].map((rate) => `opus_48000_${rate}`),
];
export const formatSchema = (kind: "speech" | "music" | "sound") =>
  t.Union(
    [
      ...compressedAndRaw,
      ...(kind === "speech" ? rates.map((rate) => `wav_${rate}`) : []),
      ...(kind === "music"
        ? ["auto", ...[128, 192, 240, 320].map((rate) => `mp3_48000_${rate}`)]
        : []),
    ].map((value) => t.Literal(value)),
    {
      default: kind === "music" ? "auto" : "mp3_44100_128",
      description:
        "Provider output format. PCM is raw audio without a WAV header; retain the sample rate and endpoint-specific channel layout. Higher-quality formats may require a paid tier.",
    },
  );
export const audioOptions = {
  ...fileOptions,
  outputFormat: t.Optional(formatSchema("speech")),
};
export const voiceSettings = t.Object(
  {
    stability: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
    similarity_boost: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
    style: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
    use_speaker_boost: t.Optional(t.Boolean()),
    speed: t.Optional(t.Number({ minimum: 0.7, maximum: 1.2 })),
  },
  STRICT,
);
export const speechControls = {
  seed: t.Optional(seed),
  pronunciationDictionaries: t.Optional(dictionaries),
  normalization: t.Optional(normalization),
  languageNormalization: t.Optional(
    t.Boolean({
      description:
        "Language-specific normalization; currently Japanese only, may increase latency.",
    }),
  ),
  previousText: t.Optional(t.String()),
  nextText: t.Optional(t.String()),
  previousRequestIds: t.Optional(t.Array(text, { maxItems: 3 })),
  nextRequestIds: t.Optional(t.Array(text, { maxItems: 3 })),
};
const styles = t.Array(t.String(), { maxItems: 50 });
const duration = t.Integer({ minimum: 3000, maximum: 120000 });
const v1Plan = t.Object(
  {
    positive_global_styles: styles,
    negative_global_styles: styles,
    sections: t.Array(
      t.Object(
        {
          section_name: t.String({ minLength: 1, maxLength: 100 }),
          positive_local_styles: styles,
          negative_local_styles: styles,
          duration_ms: duration,
          lines: t.Array(t.String({ maxLength: 200 }), { maxItems: 30 }),
        },
        STRICT,
      ),
      { minItems: 1, maxItems: 30 },
    ),
  },
  STRICT,
);
const v2Plan = t.Object(
  {
    chunks: t.Array(
      t.Object(
        {
          text: t.String({ maxLength: 6132 }),
          duration_ms: duration,
          positive_styles: styles,
          negative_styles: t.Optional(styles),
          context_adherence: t.Optional(
            t.Union([t.Literal("low"), t.Literal("medium"), t.Literal("high")]),
          ),
        },
        STRICT,
      ),
      { minItems: 1, maxItems: 30 },
    ),
  },
  STRICT,
);
const musicVariants = [
  t.Object(
    {
      ...fileOptions,
      outputFormat: t.Optional(formatSchema("music")),
      prompt: t.String({ minLength: 1, maxLength: 4100, pattern: "\\S" }),
      durationMs: t.Integer({ minimum: 3000, maximum: 600000 }),
      model: t.Optional(
        t.Union([
          t.Literal("music_v1"),
          t.Literal("music_v2"),
          t.Literal("music_v2_5"),
        ]),
      ),
      instrumental: t.Optional(t.Boolean()),
    },
    STRICT,
  ),
  t.Object(
    {
      ...fileOptions,
      outputFormat: t.Optional(formatSchema("music")),
      model: t.Literal("music_v1"),
      compositionPlan: v1Plan,
      seed: t.Optional(t.Integer({ minimum: 0, maximum: 2147483647 })),
      respectSectionsDurations: t.Optional(t.Boolean()),
    },
    STRICT,
  ),
  t.Object(
    {
      ...fileOptions,
      outputFormat: t.Optional(formatSchema("music")),
      model: t.Union([t.Literal("music_v2"), t.Literal("music_v2_5")]),
      compositionPlan: v2Plan,
      seed: t.Optional(t.Integer({ minimum: 0, maximum: 2147483647 })),
    },
    STRICT,
  ),
] satisfies [t.TSchema, t.TSchema, t.TSchema];
// Object metadata exposes fields to Runline discovery; anyOf enforces the complete alternatives.
export const musicSchema: t.TUnion<typeof musicVariants> = t.Union(
  musicVariants,
  {
    type: "object",
    properties: {
      ...Object.assign(
        {},
        ...musicVariants.map((variant) => variant.properties),
      ),
      model: t.Union([
        t.Literal("music_v1"),
        t.Literal("music_v2"),
        t.Literal("music_v2_5"),
      ]),
      compositionPlan: t.Union([v1Plan, v2Plan]),
    },
    description:
      "Supply prompt + durationMs, or compositionPlan + its compatible model. Seed is plan-only; instrumental is prompt-only.",
  },
);
