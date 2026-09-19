import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { seg } from "../../_shared/provider.js";
import {
  audioOptions,
  dictionaries,
  fileOptions,
  normalization,
  STRICT,
  seed,
  text,
  voiceSettings,
} from "./schemas.js";
import {
  appendFile,
  audioRequest,
  binaryRequest,
  jsonRequest,
  voiceForm,
  voicePath,
} from "./shared.js";

const dialogue = t.Object(
  {
    ...audioOptions,
    inputs: t.Array(t.Object({ text, voiceId: text }, STRICT), {
      minItems: 1,
      maxItems: 100,
      description:
        "At most 10 unique voices and 2000 total characters per request.",
    }),
    model: t.Optional(text),
    languageCode: t.Optional(t.String({ pattern: "^[a-z]{2}$" })),
    stability: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
    seed: t.Optional(seed),
    pronunciationDictionaries: t.Optional(dictionaries),
    normalization: t.Optional(normalization),
  },
  STRICT,
);
const isolate = t.Object({ ...fileOptions, audioPath: text }, STRICT);
const historyList = t.Object(
  {
    limit: t.Optional(t.Integer({ minimum: 1, maximum: 1000 })),
    cursor: t.Optional(text),
    voiceId: t.Optional(text),
    model: t.Optional(text),
    search: t.Optional(text),
    source: t.Optional(
      t.Union([t.Literal("TTS"), t.Literal("STS"), t.Literal("Flows")]),
    ),
  },
  STRICT,
);
const historyItem = t.Object({ historyItemId: text }, STRICT);
const historyDownload = t.Object(
  { historyItemId: text, ...fileOptions },
  STRICT,
);
const voice = t.Object({ voiceId: text }, STRICT);
const settings = t.Object(
  {
    voiceId: text,
    settings: t.Object(voiceSettings.properties, {
      ...STRICT,
      minProperties: 1,
    }),
  },
  STRICT,
);
const editVoice = t.Object(
  {
    voiceId: text,
    name: text,
    description: t.Optional(t.String()),
    labels: t.Optional(t.Record(t.String(), t.String())),
    audioPaths: t.Optional(t.Array(text, { maxItems: 10 })),
    removeBackgroundNoise: t.Optional(t.Boolean()),
  },
  STRICT,
);
const dictionaryList = t.Object(
  {
    cursor: t.Optional(text),
    limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
  },
  STRICT,
);
const ruleOptions = {
  string_to_replace: text,
  case_sensitive: t.Optional(t.Boolean()),
  word_boundaries: t.Optional(t.Boolean()),
};
const dictionaryCreate = t.Object(
  {
    name: text,
    description: t.Optional(t.String()),
    rules: t.Array(
      t.Union([
        t.Object(
          { ...ruleOptions, type: t.Literal("alias"), alias: text },
          STRICT,
        ),
        t.Object(
          {
            ...ruleOptions,
            type: t.Literal("phoneme"),
            phoneme: text,
            alphabet: text,
          },
          STRICT,
        ),
      ]),
      { minItems: 1 },
    ),
  },
  STRICT,
);
const historyPath = (id: string) =>
  `/v1/history/${seg(id, "history item id", "elevenlabs")}`;

export function registerWorkflows(rl: RunlinePluginAPI) {
  rl.registerAction("dialogue.create", {
    access: "write",
    description:
      "Generate multi-speaker dialogue with Eleven v3 (billed). Up to 10 voices and 2000 total characters. Returns audio.path.",
    inputSchema: dialogue,
    async execute(input, ctx) {
      const p = input as t.Static<typeof dialogue>;
      if (
        new Set(p.inputs.map((i) => i.voiceId)).size > 10 ||
        p.inputs.reduce((sum, i) => sum + i.text.length, 0) > 2000
      )
        throw new Error(
          "elevenlabs: dialogue allows at most 10 voices and 2000 total characters",
        );
      return audioRequest(
        ctx,
        "/v1/text-to-dialogue",
        {
          inputs: p.inputs.map((i) => ({ text: i.text, voice_id: i.voiceId })),
          model_id: p.model ?? "eleven_v3",
          language_code: p.languageCode,
          settings:
            p.stability === undefined ? undefined : { stability: p.stability },
          seed: p.seed,
          pronunciation_dictionary_locators: p.pronunciationDictionaries,
          apply_text_normalization: p.normalization,
        },
        p,
      );
    },
  });
  rl.registerAction("audio.isolate", {
    access: "write",
    description:
      "Remove background noise from a local recording (billed). Input up to 25 MiB. Saves the provider's output without transcoding.",
    inputSchema: isolate,
    async execute(input, ctx) {
      const p = input as t.Static<typeof isolate>;
      const form = new FormData();
      await appendFile(form, "audio", p.audioPath);
      return binaryRequest(
        ctx,
        "/v1/audio-isolation",
        { method: "POST", body: form },
        p,
      );
    },
  });
  rl.registerAction("history.list", {
    access: "read",
    description:
      "List speech history (TTS, STS, Flows), not a universal music/sound archive. Pass last_history_item_id as cursor while has_more is true. Zero-retention requests are unavailable.",
    inputSchema: historyList,
    async execute(input, ctx) {
      const p = input as t.Static<typeof historyList>;
      const query = new URLSearchParams({ page_size: String(p.limit ?? 100) });
      for (const [key, value] of Object.entries({
        start_after_history_item_id: p.cursor,
        voice_id: p.voiceId,
        model_id: p.model,
        search: p.search,
        source: p.source,
      }))
        if (value !== undefined) query.set(key, value);
      return jsonRequest(ctx, `/v1/history?${query}`, "history");
    },
  });
  rl.registerAction("history.get", {
    access: "read",
    description:
      "Get one speech history item, including generation settings, text, and output format.",
    inputSchema: historyItem,
    async execute(input, ctx) {
      return jsonRequest(
        ctx,
        historyPath((input as t.Static<typeof historyItem>).historyItemId),
        "historyItem",
      );
    },
  });
  rl.registerAction("history.download", {
    access: "write",
    description:
      "Recover existing speech audio without regenerating. Saves the downloaded response format to audio.path; the original generation format may differ.",
    inputSchema: historyDownload,
    async execute(input, ctx) {
      const p = input as t.Static<typeof historyDownload>;
      return binaryRequest(ctx, `${historyPath(p.historyItemId)}/audio`, {}, p);
    },
  });
  rl.registerAction("voices.settings.get", {
    access: "read",
    description: "Read a voice's saved synthesis settings.",
    inputSchema: voice,
    async execute(input, ctx) {
      return jsonRequest(
        ctx,
        `/v1/voices/${voicePath((input as t.Static<typeof voice>).voiceId)}/settings`,
        "settings",
      );
    },
  });
  rl.registerAction("voices.settings.update", {
    access: "write",
    description:
      "Update a voice's saved synthesis settings. Omitted fields follow provider defaults; read voices.settings.get to construct complete settings when preserving other values. Affects future synthesis using that voice.",
    inputSchema: settings,
    async execute(input, ctx) {
      const p = input as t.Static<typeof settings>;
      return jsonRequest(
        ctx,
        `/v1/voices/${voicePath(p.voiceId)}/settings/edit`,
        "acknowledgement",
        { method: "POST", body: JSON.stringify(p.settings) },
      );
    },
  });
  rl.registerAction("voices.update", {
    access: "write",
    description:
      "Edit voice name, description, labels, and optionally add owned/authorized audio samples (25 MiB each). Name is required by the API.",
    inputSchema: editVoice,
    async execute(input, ctx) {
      const p = input as t.Static<typeof editVoice>;
      const path = `/v1/voices/${voicePath(p.voiceId)}/edit`;
      return jsonRequest(ctx, path, "acknowledgement", {
        method: "POST",
        body: await voiceForm(p),
      });
    },
  });
  rl.registerAction("pronunciationDictionaries.list", {
    access: "read",
    description:
      "List pronunciation dictionaries and their latest version IDs for speech/dialogue generation. Pass next_cursor as cursor.",
    inputSchema: dictionaryList,
    async execute(input, ctx) {
      const p = input as t.Static<typeof dictionaryList>;
      const query = new URLSearchParams({
        page_size: String(p.limit ?? 30),
        include_archived: "false",
      });
      if (p.cursor) query.set("cursor", p.cursor);
      return jsonRequest(
        ctx,
        `/v1/pronunciation-dictionaries?${query}`,
        "dictionaries",
      );
    },
  });
  rl.registerAction("pronunciationDictionaries.create", {
    access: "write",
    description:
      "Create a pronunciation dictionary from alias or phoneme rules. Returns id and version_id; phoneme support depends on the synthesis model.",
    inputSchema: dictionaryCreate,
    async execute(input, ctx) {
      const p = input as t.Static<typeof dictionaryCreate>;
      return jsonRequest(
        ctx,
        "/v1/pronunciation-dictionaries/add-from-rules",
        "dictionary",
        { method: "POST", body: JSON.stringify(p) },
      );
    },
  });
}
