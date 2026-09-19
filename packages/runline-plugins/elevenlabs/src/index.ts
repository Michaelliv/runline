import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  audioOptions,
  formatSchema,
  musicSchema as music,
  STRICT,
  seed,
  speechControls,
  text,
  timeout,
  voiceSettings,
} from "./schemas.js";
import {
  appendFile,
  audioRequest,
  jsonRequest,
  voiceForm,
  voicePath,
} from "./shared.js";
import { registerWorkflows } from "./workflows.js";

const voice = t.Object({ voiceId: text }, STRICT);
const speech = t.Object(
  {
    ...audioOptions,
    voiceId: text,
    text,
    ...speechControls,
    timestamps: t.Optional(
      t.Boolean({
        description:
          "Return character alignment with the saved audio, not base64.",
      }),
    ),
    model: t.Optional(
      t.String({ default: "eleven_multilingual_v2", minLength: 1 }),
    ),
    languageCode: t.Optional(
      t.String({
        pattern: "^[a-z]{2}$",
        description:
          "ISO 639-1 language. Not supported by eleven_multilingual_v2; use a compatible model such as Flash or Turbo.",
      }),
    ),
    voiceSettings: t.Optional(voiceSettings),
  },
  STRICT,
);
const convert = t.Object(
  {
    ...audioOptions,
    voiceId: text,
    audioPath: t.String({
      minLength: 1,
      description: "Local audio file, at most 25 MiB.",
    }),
    model: t.Optional(
      t.String({ default: "eleven_multilingual_sts_v2", minLength: 1 }),
    ),
    voiceSettings: t.Optional(voiceSettings),
    removeBackgroundNoise: t.Optional(t.Boolean()),
    seed: t.Optional(seed),
  },
  STRICT,
);
const transcribe = t.Object(
  {
    filePath: t.Optional(
      t.String({
        minLength: 1,
        description:
          "Local audio/video file, at most 25 MiB. Exactly one of filePath or sourceUrl is required.",
      }),
    ),
    sourceUrl: t.Optional(
      t.String({
        pattern: "^https://",
        description:
          "Remote source fetched by ElevenLabs, not this host. Exactly one of filePath or sourceUrl is required.",
      }),
    ),
    timestampsGranularity: t.Optional(
      t.Union([t.Literal("none"), t.Literal("word"), t.Literal("character")]),
    ),
    keyterms: t.Optional(
      t.Array(
        t.String({
          minLength: 1,
          maxLength: 49,
          pattern: "^[^<>{}\\[\\]\\\\]+$",
        }),
        {
          maxItems: 1000,
          description:
            "Up to 5 words per term. Adds 20% cost; over 100 terms has a 20-second minimum billable duration.",
        },
      ),
    ),
    multiChannel: t.Optional(
      t.Boolean({
        description:
          "Transcribe up to 5 channels independently; each channel is billed at the full audio duration.",
      }),
    ),
    channelOutput: t.Optional(
      t.Union([t.Literal("separate"), t.Literal("combined")]),
    ),
    model: t.Optional(
      t.Union([t.Literal("scribe_v1"), t.Literal("scribe_v2")], {
        default: "scribe_v2",
      }),
    ),
    languageCode: t.Optional(text),
    diarize: t.Optional(t.Boolean()),
    numSpeakers: t.Optional(t.Integer({ minimum: 1, maximum: 32 })),
    tagAudioEvents: t.Optional(t.Boolean()),
    timeoutMs: t.Optional(timeout),
  },
  STRICT,
);
const list = t.Object(
  {
    limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 10 })),
    cursor: t.Optional(text),
    search: t.Optional(text),
  },
  STRICT,
);
const clone = t.Object(
  {
    name: text,
    audioPaths: t.Array(text, {
      minItems: 1,
      maxItems: 10,
      description:
        "Local samples, each at most 25 MiB. Only voices you own or have permission to clone.",
    }),
    description: t.Optional(text),
    labels: t.Optional(t.Record(t.String(), t.String())),
    removeBackgroundNoise: t.Optional(t.Boolean()),
  },
  STRICT,
);
const sound = t.Object(
  {
    ...audioOptions,
    outputFormat: t.Optional(formatSchema("sound")),
    text,
    durationSeconds: t.Optional(t.Number({ minimum: 0.5, maximum: 30 })),
    loop: t.Optional(t.Boolean()),
    promptInfluence: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  },
  STRICT,
);

/** Audio returns local file paths; catalog responses preserve provider pagination metadata. */
export default function elevenlabs(rl: RunlinePluginAPI): void {
  rl.setName("elevenlabs");
  rl.setVersion("0.1.0");
  registerWorkflows(rl);
  rl.setConnectionSchema(
    t.Object({
      apiKey: t.String({
        minLength: 1,
        env: "ELEVENLABS_API_KEY",
        description:
          "ElevenLabs key with permissions for the requested endpoints.",
      }),
    }),
  );
  rl.registerAction("models.list", {
    access: "read",
    description: "List ElevenLabs models and their supported capabilities.",
    inputSchema: t.Object({}, STRICT),
    async execute(_input, ctx) {
      return jsonRequest(ctx, "/v1/models", "models");
    },
  });
  rl.registerAction("voices.list", {
    access: "read",
    description:
      "Search one page of voices. Pass next_page_token back as cursor while has_more is true.",
    inputSchema: list,
    async execute(input, ctx) {
      const p = input as t.Static<typeof list>;
      const query = new URLSearchParams({ page_size: String(p.limit ?? 10) });
      if (p.cursor !== undefined) query.set("next_page_token", p.cursor);
      if (p.search !== undefined) query.set("search", p.search);
      return jsonRequest(ctx, `/v2/voices?${query}`, "voices");
    },
  });
  rl.registerAction("voices.get", {
    access: "read",
    description: "Get voice metadata and settings by ID.",
    inputSchema: voice,
    async execute(input, ctx) {
      return jsonRequest(
        ctx,
        `/v1/voices/${voicePath((input as t.Static<typeof voice>).voiceId)}`,
        "voice",
      );
    },
  });
  rl.registerAction("voices.delete", {
    access: "write",
    description: "Delete a voice from your ElevenLabs account.",
    inputSchema: voice,
    async execute(input, ctx) {
      return jsonRequest(
        ctx,
        `/v1/voices/${voicePath((input as t.Static<typeof voice>).voiceId)}`,
        "acknowledgement",
        { method: "DELETE" },
      );
    },
  });
  rl.registerAction("voices.clone", {
    access: "write",
    description:
      "Create an instant voice clone from local audio samples you own or have permission to use. Returns voice_id and any verification requirement.",
    inputSchema: clone,
    async execute(input, ctx) {
      const p = input as t.Static<typeof clone>;
      return jsonRequest(ctx, "/v1/voices/add", "clone", {
        method: "POST",
        body: await voiceForm(p),
      });
    },
  });
  rl.registerAction("speech.create", {
    access: "write",
    description:
      "Convert text to speech (billed). Returns audio.path for send_file and optional character timestamps. Select a voice with voices.list; format support depends on the endpoint and account tier.",
    inputSchema: speech,
    async execute(input, ctx) {
      const p = input as t.Static<typeof speech>;
      return audioRequest(
        ctx,
        `/v1/text-to-speech/${voicePath(p.voiceId)}${p.timestamps ? "/with-timestamps" : ""}`,
        {
          text: p.text,
          model_id: p.model ?? "eleven_multilingual_v2",
          language_code: p.languageCode,
          voice_settings: p.voiceSettings,
          seed: p.seed,
          pronunciation_dictionary_locators: p.pronunciationDictionaries,
          apply_text_normalization: p.normalization,
          apply_language_text_normalization: p.languageNormalization,
          previous_text: p.previousText,
          next_text: p.nextText,
          previous_request_ids: p.previousRequestIds,
          next_request_ids: p.nextRequestIds,
        },
        p,
      );
    },
  });
  rl.registerAction("speech.convert", {
    access: "write",
    description:
      "Change a local recording to another voice (billed), preserving delivery. Returns audio.path in the requested format.",
    inputSchema: convert,
    async execute(input, ctx) {
      const p = input as t.Static<typeof convert>;
      const path = `/v1/speech-to-speech/${voicePath(p.voiceId)}`;
      const form = new FormData();
      await appendFile(form, "audio", p.audioPath);
      form.append("model_id", p.model ?? "eleven_multilingual_sts_v2");
      if (p.seed !== undefined) form.append("seed", String(p.seed));
      if (p.voiceSettings !== undefined)
        form.append("voice_settings", JSON.stringify(p.voiceSettings));
      if (p.removeBackgroundNoise !== undefined)
        form.append("remove_background_noise", String(p.removeBackgroundNoise));
      return audioRequest(ctx, path, form, p);
    },
  });
  rl.registerAction("transcription.create", {
    access: "write",
    description:
      "Transcribe local audio/video or an HTTPS source with Scribe (billed). Returns text, selectable timestamps, and speaker labels; multichannel mode can return transcripts[]. Keyterms add 20%; each channel is billed separately.",
    inputSchema: transcribe,
    async execute(input, ctx) {
      const p = input as t.Static<typeof transcribe>;
      if (Boolean(p.filePath) === Boolean(p.sourceUrl))
        throw new Error(
          "elevenlabs: supply exactly one of filePath or sourceUrl",
        );
      if (p.channelOutput && !p.multiChannel)
        throw new Error("elevenlabs: channelOutput requires multiChannel");
      if (p.channelOutput === "combined" && p.timestampsGranularity === "none")
        throw new Error("elevenlabs: combined channels require timestamps");
      if (
        p.keyterms?.some(
          (term) => !term.trim() || term.trim().split(/\s+/u).length > 5,
        )
      )
        throw new Error("elevenlabs: keyterms allow at most 5 words each");
      const form = new FormData();
      if (p.filePath) await appendFile(form, "file", p.filePath);
      if (p.sourceUrl) {
        const url = new URL(p.sourceUrl);
        if (url.protocol !== "https:" || url.username || url.password)
          throw new Error(
            "elevenlabs: sourceUrl requires HTTPS without embedded credentials",
          );
        form.append("source_url", url.href);
      }
      for (const term of p.keyterms ?? []) form.append("keyterms", term);
      form.append("model_id", p.model ?? "scribe_v2");
      for (const [key, value] of Object.entries({
        language_code: p.languageCode,
        diarize: p.diarize,
        num_speakers: p.numSpeakers,
        tag_audio_events: p.tagAudioEvents,
        timestamps_granularity: p.timestampsGranularity,
        use_multi_channel: p.multiChannel,
        multichannel_output_style: p.channelOutput,
      })) {
        if (value !== undefined) form.append(key, String(value));
      }
      return jsonRequest(
        ctx,
        "/v1/speech-to-text",
        "transcription",
        { method: "POST", body: form },
        p.timeoutMs ?? 300_000,
      );
    },
  });
  rl.registerAction("music.create", {
    access: "write",
    description:
      "Compose music (billed) from either prompt + durationMs, or a model-specific compositionPlan with explicit section durations. Supports v1 sections and v2/v2.5 chunks. Returns audio.path; plans are capped at 10 minutes total.",
    inputSchema: music,
    async execute(input, ctx) {
      const p = input as t.Static<typeof music>;
      if ("compositionPlan" in p) {
        const parts =
          "sections" in p.compositionPlan
            ? p.compositionPlan.sections
            : p.compositionPlan.chunks;
        if (parts.reduce((sum, part) => sum + part.duration_ms, 0) > 600000)
          throw new Error(
            "elevenlabs: composition plans are limited to 600000ms total",
          );
      }
      return audioRequest(
        ctx,
        "/v1/music",
        "prompt" in p
          ? {
              prompt: p.prompt,
              music_length_ms: p.durationMs,
              model_id: p.model ?? "music_v1",
              force_instrumental: p.instrumental ?? false,
            }
          : {
              composition_plan: p.compositionPlan,
              model_id: p.model,
              seed: p.seed,
              respect_sections_durations:
                "respectSectionsDurations" in p
                  ? p.respectSectionsDurations
                  : undefined,
            },
        { ...p, outputFormat: p.outputFormat ?? "auto" },
      );
    },
  });
  rl.registerAction("sound.create", {
    access: "write",
    description:
      "Generate sound effects from text (billed) using eleven_text_to_sound_v2. Returns audio.path in the requested format.",
    inputSchema: sound,
    async execute(input, ctx) {
      const p = input as t.Static<typeof sound>;
      return audioRequest(
        ctx,
        "/v1/sound-generation",
        {
          text: p.text,
          model_id: "eleven_text_to_sound_v2",
          duration_seconds: p.durationSeconds,
          loop: p.loop,
          prompt_influence: p.promptInfluence,
        },
        p,
      );
    },
  });
}
