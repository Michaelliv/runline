import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { appendFile, audioRequest, jsonRequest, voicePath } from "./shared.js";

const STRICT = { additionalProperties: false } as const;
const text = t.String({ minLength: 1, pattern: "\\S" });
const voice = t.Object({ voiceId: text }, STRICT);
const timeout = t.Integer({
  minimum: 1000,
  maximum: 3_600_000,
  default: 300_000,
  description:
    "Request deadline including response body. Does not cancel billed server work.",
});
const mp3Formats = [
  t.Literal("mp3_22050_32"),
  t.Literal("mp3_24000_48"),
  t.Literal("mp3_44100_32"),
  t.Literal("mp3_44100_64"),
  t.Literal("mp3_44100_96"),
  t.Literal("mp3_44100_128"),
  t.Literal("mp3_44100_192"),
];
const audioOptions = {
  saveDir: t.Optional(
    t.String({
      minLength: 1,
      description: "Existing output directory; defaults to OS temp directory.",
    }),
  ),
  timeoutMs: t.Optional(timeout),
  outputFormat: t.Optional(
    t.Union(mp3Formats, {
      default: "mp3_44100_128",
      description: "MP3 output. Higher bitrates may require a paid tier.",
    }),
  ),
};
const voiceSettings = t.Object(
  {
    stability: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
    similarity_boost: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
    style: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
    use_speaker_boost: t.Optional(t.Boolean()),
    speed: t.Optional(t.Number({ minimum: 0.7, maximum: 1.2 })),
  },
  STRICT,
);
const speech = t.Object(
  {
    ...audioOptions,
    voiceId: text,
    text,
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
  },
  STRICT,
);
const transcribe = t.Object(
  {
    filePath: t.String({
      minLength: 1,
      description: "Local audio/video file, at most 25 MiB.",
    }),
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
const music = t.Object(
  {
    ...audioOptions,
    outputFormat: t.Optional(
      t.Union(
        [
          ...mp3Formats,
          t.Literal("auto"),
          t.Literal("mp3_48000_128"),
          t.Literal("mp3_48000_192"),
          t.Literal("mp3_48000_240"),
          t.Literal("mp3_48000_320"),
        ],
        {
          default: "auto",
          description:
            "auto selects the model's native MP3 format: 44.1 kHz for v1, 48 kHz for v2.",
        },
      ),
    ),
    prompt: t.String({
      minLength: 1,
      maxLength: 4100,
      pattern: "\\S",
      description:
        "Describe genre, mood, instrumentation, and optional lyrics.",
    }),
    durationMs: t.Integer({
      minimum: 3000,
      maximum: 600000,
      description:
        "Explicit duration in milliseconds to control billed generation length.",
    }),
    model: t.Optional(
      t.Union(
        [t.Literal("music_v1"), t.Literal("music_v2"), t.Literal("music_v2_5")],
        { default: "music_v1" },
      ),
    ),
    instrumental: t.Optional(t.Boolean({ default: false })),
  },
  STRICT,
);
const sound = t.Object(
  {
    ...audioOptions,
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
        "deletion",
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
      const form = new FormData();
      form.append("name", p.name);
      for (const path of p.audioPaths) await appendFile(form, "files", path);
      if (p.description !== undefined)
        form.append("description", p.description);
      if (p.labels !== undefined)
        form.append("labels", JSON.stringify(p.labels));
      if (p.removeBackgroundNoise !== undefined)
        form.append("remove_background_noise", String(p.removeBackgroundNoise));
      return jsonRequest(ctx, "/v1/voices/add", "clone", {
        method: "POST",
        body: form,
      });
    },
  });
  rl.registerAction("speech.create", {
    access: "write",
    description:
      "Convert text to speech (billed). Returns audio.path for send_file. Select a voice with voices.list; output is MP3.",
    inputSchema: speech,
    async execute(input, ctx) {
      const p = input as t.Static<typeof speech>;
      return audioRequest(
        ctx,
        `/v1/text-to-speech/${voicePath(p.voiceId)}`,
        {
          text: p.text,
          model_id: p.model ?? "eleven_multilingual_v2",
          language_code: p.languageCode,
          voice_settings: p.voiceSettings,
        },
        p,
      );
    },
  });
  rl.registerAction("speech.convert", {
    access: "write",
    description:
      "Change a local recording to another voice (billed), preserving delivery. Returns MP3 audio.path.",
    inputSchema: convert,
    async execute(input, ctx) {
      const p = input as t.Static<typeof convert>;
      const path = `/v1/speech-to-speech/${voicePath(p.voiceId)}`;
      const form = new FormData();
      await appendFile(form, "audio", p.audioPath);
      form.append("model_id", p.model ?? "eleven_multilingual_sts_v2");
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
      "Transcribe a local audio/video file with Scribe (billed). Returns provider text, word timestamps, and optional speaker labels.",
    inputSchema: transcribe,
    async execute(input, ctx) {
      const p = input as t.Static<typeof transcribe>;
      const form = new FormData();
      await appendFile(form, "file", p.filePath);
      form.append("model_id", p.model ?? "scribe_v2");
      for (const [key, value] of Object.entries({
        language_code: p.languageCode,
        diarize: p.diarize,
        num_speakers: p.numSpeakers,
        tag_audio_events: p.tagAudioEvents,
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
      "Compose music from a prompt (billed). Requires durationMs to bound cost; supports vocals or guaranteed instrumental output. Returns MP3 audio.path. Composition plans are not supported by this action.",
    inputSchema: music,
    async execute(input, ctx) {
      const p = input as t.Static<typeof music>;
      return audioRequest(
        ctx,
        "/v1/music",
        {
          prompt: p.prompt,
          music_length_ms: p.durationMs,
          model_id: p.model ?? "music_v1",
          force_instrumental: p.instrumental ?? false,
        },
        { ...p, outputFormat: p.outputFormat ?? "auto" },
      );
    },
  });
  rl.registerAction("sound.create", {
    access: "write",
    description:
      "Generate sound effects from text (billed) using eleven_text_to_sound_v2. Returns MP3 audio.path.",
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
