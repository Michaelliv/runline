import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, describe, it } from "node:test";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import elevenlabs from "../../../runline-plugins/elevenlabs/src/index.js";
import { createPluginAPI } from "../plugin/api.js";
import { helpInputs } from "../plugin/schema.js";
import type { ActionContext } from "../plugin/types.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const dir = mkdtempSync(join(tmpdir(), "elevenlabs-test-"));
const source = join(dir, "input.mp3");
const bytes = Buffer.from("ID3-test-audio");
writeFileSync(source, bytes);
after(() => rmSync(dir, { recursive: true, force: true }));
const { api, resolve } = createPluginAPI("elevenlabs");
elevenlabs(api);
const plugin = resolve();
const ctx: ActionContext = {
  connection: {
    name: "test",
    plugin: "elevenlabs",
    config: { apiKey: "test-key" },
  },
  log: { info() {}, warn() {}, error() {} },
  async updateConnection() {},
};
function action(name: string) {
  const a = plugin.actions.find((a) => a.name === name);
  assert.ok(a);
  return a;
}
function run(name: string, input: unknown = {}) {
  return action(name).execute(input, ctx);
}
function mock(body: unknown = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return body instanceof Response ? body : Response.json(body);
  }) as typeof fetch;
  return calls;
}
function audio() {
  return new Response(bytes, {
    headers: {
      "content-type": "audio/mpeg",
      "request-id": "req-1",
      "song-id": "song-1",
      "character-cost": "80",
    },
  });
}

describe("elevenlabs plugin", () => {
  it("registers 20 creative-audio actions with explicit access levels", () => {
    assert.deepEqual(plugin.actions.map((a) => a.name).sort(), [
      "audio.isolate",
      "dialogue.create",
      "history.download",
      "history.get",
      "history.list",
      "models.list",
      "music.create",
      "pronunciationDictionaries.create",
      "pronunciationDictionaries.list",
      "sound.create",
      "speech.convert",
      "speech.create",
      "transcription.create",
      "voices.clone",
      "voices.delete",
      "voices.get",
      "voices.list",
      "voices.settings.get",
      "voices.settings.update",
      "voices.update",
    ]);
    for (const a of plugin.actions)
      assert.equal(
        a.access,
        [
          "models.list",
          "voices.get",
          "voices.list",
          "history.get",
          "history.list",
          "voices.settings.get",
          "pronunciationDictionaries.list",
        ].includes(a.name)
          ? "read"
          : "write",
      );
  });
  it("validates typed limits and refuses unknown fields before execution", () => {
    for (const [name, valid, invalid] of [
      [
        "music.create",
        { prompt: "ambient", durationMs: 3000 },
        { prompt: "ambient" },
      ],
      [
        "speech.create",
        { text: "hello", voiceId: "v" },
        { text: " ", voiceId: "v" },
      ],
      [
        "voices.clone",
        { name: "me", audioPaths: [source] },
        { name: "me", audioPaths: [] },
      ],
      ["voices.list", { limit: 100 }, { limit: 101 }],
      [
        "transcription.create",
        { filePath: source, numSpeakers: 32 },
        { filePath: source, numSpeakers: 33 },
      ],
      [
        "sound.create",
        { text: "rain", durationSeconds: 30 },
        { text: "rain", durationSeconds: 31 },
      ],
    ] as const) {
      const schema = action(name).inputSchema as TSchema;
      assert.ok(Check(schema, valid));
      assert.equal(Check(schema, invalid), false);
      assert.equal(Check(schema, { ...valid, unexpected: true }), false);
    }
    assert.equal(
      Check(action("speech.create").inputSchema as TSchema, {
        text: "hello",
        voiceId: "v",
        outputFormat: "not-an-audio-format",
      }),
      false,
    );
  });
  it("uses xi-api-key, pinned origin, deadline and redirect refusal", async () => {
    const calls = mock([]);
    await run("models.list");
    assert.equal(calls[0].url, "https://api.elevenlabs.io/v1/models");
    assert.equal(
      new Headers(calls[0].init.headers).get("xi-api-key"),
      "test-key",
    );
    assert.equal(calls[0].init.redirect, "error");
    assert.ok(calls[0].init.signal);
  });
  it("rejects missing credentials without fetching", async () => {
    const calls = mock();
    await assert.rejects(
      () =>
        action("models.list").execute(
          {},
          { ...ctx, connection: { ...ctx.connection, config: {} } },
        ),
      /ELEVENLABS_API_KEY/,
    );
    assert.equal(calls.length, 0);
  });
  it("preserves voice pagination and encodes search and cursor", async () => {
    const result = { voices: [], has_more: true, next_page_token: "next" };
    const calls = mock(result);
    assert.deepEqual(
      await run("voices.list", { search: "A & B", cursor: "x+y", limit: 5 }),
      result,
    );
    const url = new URL(calls[0].url);
    assert.equal(url.pathname, "/v2/voices");
    assert.equal(url.searchParams.get("search"), "A & B");
    assert.equal(url.searchParams.get("next_page_token"), "x+y");
    assert.equal(url.searchParams.get("page_size"), "5");
  });
  it("uses GET and DELETE on the same voice path with the documented JSON receipt", async () => {
    let calls = mock({ voice_id: "v", name: "Voice" });
    await run("voices.get", { voiceId: "v" });
    assert.equal(calls[0].url, "https://api.elevenlabs.io/v1/voices/v");
    calls = mock({ status: "ok" });
    assert.deepEqual(await run("voices.delete", { voiceId: "v" }), {
      status: "ok",
    });
    assert.equal(calls[0].init.method, "DELETE");
  });
  it("rejects unsafe voice IDs on all voice-specific actions", async () => {
    const calls = mock();
    for (const name of [
      "voices.get",
      "voices.delete",
      "speech.create",
      "speech.convert",
      "voices.update",
      "voices.settings.get",
      "voices.settings.update",
    ]) {
      for (const voiceId of ["..", "a/b", "x?y", ""])
        await assert.rejects(
          () => run(name, { voiceId, text: "hello", audioPath: source }),
          /invalid voice id/,
        );
    }
    assert.equal(calls.length, 0);
  });
  it("saves speech as a private MP3 and retains request IDs", async () => {
    const calls = mock(audio());
    const result = (await run("speech.create", {
      voiceId: "v",
      text: "hello",
      saveDir: dir,
      voiceSettings: { stability: 0.5 },
    })) as { audio: { path: string }; requestId: string };
    assert.equal(
      calls[0].url,
      "https://api.elevenlabs.io/v1/text-to-speech/v?output_format=mp3_44100_128",
    );
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      text: "hello",
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5 },
    });
    assert.deepEqual(readFileSync(result.audio.path), bytes);
    assert.ok(result.audio.path.endsWith(".mp3"));
    assert.equal(statSync(result.audio.path).mode & 0o777, 0o600);
    assert.equal(result.requestId, "req-1");
  });
  it("maps music duration and instrumental settings to the provider", async () => {
    const calls = mock(audio());
    await run("music.create", {
      prompt: "ambient",
      durationMs: 10000,
      instrumental: true,
      model: "music_v2",
      saveDir: dir,
    });
    assert.equal(new URL(calls[0].url).pathname, "/v1/music");
    assert.equal(
      new URL(calls[0].url).searchParams.get("output_format"),
      "auto",
    );
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      prompt: "ambient",
      music_length_ms: 10000,
      force_instrumental: true,
      model_id: "music_v2",
    });
  });
  it("supports native music MP3 formats without exposing them to speech", async () => {
    for (const outputFormat of [
      "auto",
      "mp3_48000_128",
      "mp3_48000_192",
      "mp3_48000_240",
      "mp3_48000_320",
    ]) {
      assert.ok(
        Check(action("music.create").inputSchema as TSchema, {
          prompt: "ambient",
          durationMs: 3000,
          outputFormat,
        }),
      );
      assert.equal(
        Check(action("speech.create").inputSchema as TSchema, {
          voiceId: "v",
          text: "hello",
          outputFormat,
        }),
        false,
      );
    }
    const calls = mock(audio());
    const result = (await run("music.create", {
      prompt: "ambient",
      durationMs: 3000,
      outputFormat: "mp3_48000_320",
      saveDir: dir,
    })) as { songId: string; characterCost: string };
    assert.equal(
      new URL(calls[0].url).searchParams.get("output_format"),
      "mp3_48000_320",
    );
    assert.equal(result.songId, "song-1");
    assert.equal(result.characterCost, "80");
  });
  it("validates catalog, cloning, deletion and transcription response fields", async () => {
    for (const [name, input] of [
      ["models.list", {}],
      ["voices.list", {}],
      ["voices.get", { voiceId: "v" }],
      ["voices.delete", { voiceId: "v" }],
      ["voices.clone", { name: "me", audioPaths: [source] }],
      ["transcription.create", { filePath: source }],
    ] as const) {
      mock({});
      await assert.rejects(() => run(name, input), /invalid .* response/);
    }
    mock({ voices: [], has_more: true, next_page_token: null });
    await assert.rejects(() => run("voices.list"), /continuation token/);
    mock({ text: "", words: [] });
    assert.deepEqual(await run("transcription.create", { filePath: source }), {
      text: "",
      words: [],
    });
    mock({ status: "failed" });
    await assert.rejects(
      () => run("voices.delete", { voiceId: "v" }),
      /invalid acknowledgement response/,
    );
  });
  it("validates management responses and continuation tokens", async () => {
    for (const [name, input] of [
      ["history.list", {}],
      ["history.get", { historyItemId: "h" }],
      ["pronunciationDictionaries.list", {}],
      [
        "pronunciationDictionaries.create",
        {
          name: "Names",
          rules: [{ type: "alias", string_to_replace: "x", alias: "ex" }],
        },
      ],
      ["voices.update", { voiceId: "v", name: "Name" }],
      ["voices.settings.update", { voiceId: "v", settings: { stability: 0 } }],
    ] as const) {
      mock({});
      await assert.rejects(() => run(name, input), /invalid .* response/);
    }
    for (const [name, response] of [
      ["history.list", { history: [], has_more: true }],
      [
        "pronunciationDictionaries.list",
        { pronunciation_dictionaries: [], has_more: true },
      ],
    ] as const) {
      mock(response);
      await assert.rejects(() => run(name), /continuation token/);
    }
    mock({ stability: null });
    assert.deepEqual(await run("voices.settings.get", { voiceId: "v" }), {
      stability: null,
    });
    mock({ stability: "invalid" });
    await assert.rejects(
      () => run("voices.settings.get", { voiceId: "v" }),
      /invalid settings/,
    );
  });
  it("maps sound effects and explicit false options", async () => {
    const calls = mock(audio());
    await run("sound.create", {
      text: "rain",
      durationSeconds: 3,
      loop: false,
      promptInfluence: 0,
      saveDir: dir,
    });
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      text: "rain",
      duration_seconds: 3,
      loop: false,
      prompt_influence: 0,
      model_id: "eleven_text_to_sound_v2",
    });
  });
  it("uploads speech conversion as multipart with JSON voice settings", async () => {
    const calls = mock(audio());
    await run("speech.convert", {
      voiceId: "v",
      audioPath: source,
      voiceSettings: { style: 0 },
      removeBackgroundNoise: false,
      saveDir: dir,
    });
    const form = calls[0].init.body as FormData;
    assert.equal(form.get("voice_settings"), '{"style":0}');
    assert.equal(form.get("remove_background_noise"), "false");
    assert.equal(form.get("model_id"), "eleven_multilingual_sts_v2");
    assert.deepEqual(
      Buffer.from(await (form.get("audio") as Blob).arrayBuffer()),
      bytes,
    );
    assert.equal(
      new Headers(calls[0].init.headers).get("content-type"),
      null,
      "fetch supplies the multipart boundary",
    );
  });
  it("transcribes with Scribe and keeps word/speaker metadata", async () => {
    const output = {
      text: "hello",
      words: [{ text: "hello", speaker_id: "speaker_0" }],
    };
    const calls = mock(output);
    assert.deepEqual(
      await run("transcription.create", {
        filePath: source,
        diarize: false,
        tagAudioEvents: false,
        numSpeakers: 2,
      }),
      output,
    );
    const form = calls[0].init.body as FormData;
    assert.equal(form.get("model_id"), "scribe_v2");
    assert.equal(form.get("diarize"), "false");
    assert.equal(form.get("tag_audio_events"), "false");
    assert.equal(form.get("num_speakers"), "2");
  });
  it("clones from repeated file parts and serializes labels", async () => {
    const calls = mock({ voice_id: "v", requires_verification: true });
    await run("voices.clone", {
      name: "my voice",
      audioPaths: [source, source],
      labels: { language: "en" },
    });
    const form = calls[0].init.body as FormData;
    assert.equal(form.getAll("files").length, 2);
    assert.equal(form.get("labels"), '{"language":"en"}');
  });
  it("rejects empty, oversized and non-file uploads before sending", async () => {
    const empty = join(dir, "empty.mp3");
    writeFileSync(empty, "");
    const large = join(dir, "large.mp3");
    writeFileSync(large, "");
    truncateSync(large, 26 * 1024 * 1024);
    const calls = mock();
    for (const filePath of [empty, large, dir])
      await assert.rejects(
        () => run("transcription.create", { filePath }),
        /regular file/,
      );
    assert.equal(calls.length, 0);
  });
  it("rejects redirects, even when fetch ignores redirect:error", async () => {
    mock(new Response(null, { status: 302 }));
    await assert.rejects(() => run("models.list"), /Refusing a redirect/);
  });
  it("reports quota errors without retrying", async () => {
    const calls = mock(
      Response.json(
        {
          detail: { status: "quota_exceeded", message: "Insufficient credits" },
        },
        { status: 401 },
      ),
    );
    await assert.rejects(
      () => run("speech.create", { voiceId: "v", text: "hello" }),
      /401.*quota_exceeded.*do not retry/,
    );
    assert.equal(calls.length, 1);
  });
  it("reports validation fields without echoing their input", async () => {
    mock(
      Response.json(
        {
          detail: [
            { loc: ["body", "text"], msg: "Field required", input: "private" },
          ],
        },
        { status: 422 },
      ),
    );
    await assert.rejects(
      () => run("models.list"),
      (error: Error) =>
        error.message.includes("body.text: Field required") &&
        !error.message.includes("private"),
    );
  });
  it("rejects empty audio and unexpected JSON successes", async () => {
    for (const response of [
      new Response(new Uint8Array(), {
        headers: { "content-type": "audio/mpeg" },
      }),
      Response.json({ error: "bad" }),
    ]) {
      mock(response);
      await assert.rejects(
        () => run("speech.create", { voiceId: "v", text: "hi" }),
        /empty audio|expected audio/,
      );
    }
  });
  it("retains request IDs and no-retry guidance for every mutation", async () => {
    for (const [name, input] of [
      ["speech.create", { voiceId: "v", text: "hello" }],
      ["speech.convert", { voiceId: "v", audioPath: source }],
      ["transcription.create", { filePath: source }],
      ["voices.clone", { name: "me", audioPaths: [source] }],
      ["voices.delete", { voiceId: "v" }],
      ["music.create", { prompt: "ambient", durationMs: 3000 }],
      ["sound.create", { text: "rain" }],
      ["dialogue.create", { inputs: [{ text: "Hi", voiceId: "v" }] }],
      ["audio.isolate", { audioPath: source }],
      ["voices.update", { voiceId: "v", name: "Name" }],
      [
        "voices.settings.update",
        { voiceId: "v", settings: { stability: 0.5 } },
      ],
      [
        "pronunciationDictionaries.create",
        {
          name: "Names",
          rules: [{ type: "alias", string_to_replace: "x", alias: "ex" }],
        },
      ],
    ] as const) {
      const calls = mock(
        Response.json(
          { detail: "unavailable" },
          {
            status: 503,
            headers: { "request-id": "req-failed" },
          },
        ),
      );
      await assert.rejects(
        () => run(name, input),
        /503.*req-failed.*do not retry automatically/,
      );
      assert.equal(calls.length, 1);
    }
  });
  it("rejects empty and primitive JSON successes instead of claiming success", async () => {
    for (const response of [
      new Response(""),
      Response.json(null),
      Response.json("ok"),
      Response.json(false),
    ]) {
      mock(response);
      await assert.rejects(
        () => run("models.list"),
        /expected a JSON object or array/,
      );
    }
  });
  it("bounds JSON bodies and cancels their readers", async () => {
    let cancelled = false;
    mock(
      new Response(
        new ReadableStream({
          pull(c) {
            c.enqueue(new Uint8Array(1024 * 1024));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
    );
    await assert.rejects(() => run("models.list"), /JSON exceeds 8 MiB/);
    assert.ok(cancelled);
  });
  it("keeps the deadline active while consuming audio and JSON bodies", async () => {
    for (const [name, input] of [
      ["speech.create", { voiceId: "v", text: "hello" }],
      ["transcription.create", { filePath: source }],
    ] as const) {
      let calls = 0;
      globalThis.fetch = (async (
        _url: RequestInfo | URL,
        init?: RequestInit,
      ) => {
        calls++;
        return new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                "abort",
                () => controller.error(init.signal?.reason),
                { once: true },
              );
            },
          }),
          {
            headers: { "content-type": "audio/mpeg", "request-id": "stalled" },
          },
        );
      }) as typeof fetch;
      await assert.rejects(
        () => run(name, { ...input, timeoutMs: 1000 }),
        /stalled.*do not retry automatically/,
      );
      assert.equal(calls, 1);
    }
  });
  it("retains billing context when the local file write fails", async () => {
    mock(audio());
    await assert.rejects(
      () =>
        run("sound.create", { text: "rain", saveDir: join(dir, "missing") }),
      /req-1.*do not retry automatically/,
    );
  });
  it("rejects FIFO uploads without waiting for a writer", {
    skip: process.platform === "win32",
  }, async () => {
    const fifo = join(dir, "fifo");
    execFileSync("mkfifo", [fifo]);
    const calls = mock();
    for (const [name, input] of [
      ["transcription.create", { filePath: fifo }],
      ["speech.convert", { voiceId: "v", audioPath: fifo }],
      ["voices.clone", { name: "me", audioPaths: [fifo] }],
    ] as const)
      await assert.rejects(() => run(name, input), /regular file/);
    assert.equal(calls.length, 0);
  });
  it("saves WAV, raw PCM and Opus with correct MIME and extension", async () => {
    for (const [outputFormat, mime, extension] of [
      ["wav_44100", "audio/wav", ".wav"],
      ["pcm_16000", "audio/x-pcm", ".pcm"],
      ["opus_48000_128", "audio/ogg", ".ogg"],
    ]) {
      mock(
        new Response(bytes, {
          headers: { "content-type": "application/octet-stream" },
        }),
      );
      const out = (await run("speech.create", {
        voiceId: "v",
        text: "hello",
        outputFormat,
        saveDir: dir,
      })) as {
        audio: { path: string; mimeType: string };
        outputFormat: string;
      };
      assert.equal(out.audio.mimeType, mime);
      assert.ok(out.audio.path.endsWith(extension));
      assert.deepEqual(readFileSync(out.audio.path), bytes);
      assert.equal(out.outputFormat, outputFormat);
    }
    assert.equal(
      Check(action("music.create").inputSchema as TSchema, {
        prompt: "rain",
        durationMs: 3000,
        outputFormat: "wav_44100",
      }),
      false,
    );
    assert.equal(
      Check(action("sound.create").inputSchema as TSchema, {
        text: "rain",
        outputFormat: "wav_44100",
      }),
      false,
    );
  });
  it("saves timestamped audio without exposing base64 and maps speech controls", async () => {
    const alignment = {
      characters: ["H"],
      character_start_times_seconds: [0],
      character_end_times_seconds: [0.1],
    };
    const calls = mock({
      audio_base64: bytes.toString("base64"),
      alignment,
      normalized_alignment: alignment,
    });
    const out = (await run("speech.create", {
      voiceId: "v",
      text: "Hi",
      timestamps: true,
      seed: 0,
      normalization: "off",
      languageNormalization: false,
      previousText: "Before",
      nextText: "After",
      previousRequestIds: ["r1"],
      nextRequestIds: ["r2"],
      pronunciationDictionaries: [{ pronunciation_dictionary_id: "d" }],
      saveDir: dir,
    })) as { audio: { path: string }; alignment: unknown };
    assert.ok(calls[0].url.includes("/with-timestamps?"));
    assert.deepEqual(out.alignment, alignment);
    assert.equal("audio_base64" in out, false);
    assert.deepEqual(readFileSync(out.audio.path), bytes);
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal(body.seed, 0);
    assert.equal(body.apply_text_normalization, "off");
    assert.equal(body.apply_language_text_normalization, false);
    assert.equal(body.previous_text, "Before");
    assert.deepEqual(body.next_request_ids, ["r2"]);
    assert.deepEqual(body.pronunciation_dictionary_locators, [
      { pronunciation_dictionary_id: "d" },
    ]);
  });
  it("rejects invalid base64 and mismatched alignment before writing audio", async () => {
    for (const output of [
      { audio_base64: "!!!" },
      { audio_base64: "a" },
      {
        audio_base64: bytes.toString("base64"),
        alignment: {
          characters: ["H"],
          character_start_times_seconds: [],
          character_end_times_seconds: [],
        },
      },
    ]) {
      mock(output);
      await assert.rejects(
        () =>
          run("speech.create", { voiceId: "v", text: "hi", timestamps: true }),
        /invalid align/,
      );
    }
  });
  it("accepts model-specific music plans and rejects incompatible input combinations", async () => {
    const section = {
      section_name: "Verse",
      duration_ms: 3000,
      lines: ["Hello"],
      positive_local_styles: [],
      negative_local_styles: [],
    };
    const v1 = {
      positive_global_styles: ["pop"],
      negative_global_styles: [],
      sections: [section],
    };
    const v2 = {
      chunks: [
        { text: "[Verse] Hello", duration_ms: 3000, positive_styles: ["pop"] },
      ],
    };
    const schema = action("music.create").inputSchema as TSchema;
    for (const [model, compositionPlan] of [
      ["music_v1", v1],
      ["music_v2", v2],
      ["music_v2_5", v2],
    ] as const) {
      assert.ok(Check(schema, { model, compositionPlan }));
      const calls = mock(audio());
      await run("music.create", {
        model,
        compositionPlan,
        seed: 0,
        saveDir: dir,
      });
      const body = JSON.parse(String(calls[0].init.body));
      assert.deepEqual(body.composition_plan, compositionPlan);
      assert.equal(body.seed, 0);
      assert.equal("prompt" in body, false);
    }
    for (const input of [
      { model: "music_v2", compositionPlan: v1 },
      { model: "music_v1", compositionPlan: v2 },
      { prompt: "a", durationMs: 3000, compositionPlan: v1 },
      { prompt: "a", durationMs: 3000, seed: 1 },
    ])
      assert.equal(Check(schema, input), false);
    const calls = mock();
    await assert.rejects(
      () =>
        run("music.create", {
          model: "music_v1",
          compositionPlan: {
            ...v1,
            sections: Array(6).fill({ ...section, duration_ms: 120000 }),
          },
        }),
      /600000ms/,
    );
    assert.equal(calls.length, 0);
  });
  it("exposes both music request shapes through Runline discovery", () => {
    const fields = helpInputs(action("music.create").inputSchema);
    assert.ok(fields.prompt);
    assert.ok(fields.durationMs);
    assert.ok(fields.compositionPlan.variants?.length === 2);
    assert.deepEqual(fields.model.enum, ["music_v1", "music_v2", "music_v2_5"]);
  });
  it("maps dialogue and rejects oversized conversations before billing", async () => {
    const calls = mock(audio());
    await run("dialogue.create", {
      inputs: [
        { text: "Hello", voiceId: "v1" },
        { text: "Hi", voiceId: "v2" },
      ],
      stability: 0,
      saveDir: dir,
    });
    const body = JSON.parse(String(calls[0].init.body));
    assert.equal(body.model_id, "eleven_v3");
    assert.equal(body.inputs[0].voice_id, "v1");
    assert.deepEqual(body.settings, { stability: 0 });
    await assert.rejects(
      () =>
        run("dialogue.create", {
          inputs: [{ text: "a".repeat(2001), voiceId: "v" }],
        }),
      /2000/,
    );
    await assert.rejects(
      () =>
        run("dialogue.create", {
          inputs: Array.from({ length: 11 }, (_, i) => ({
            text: "hi",
            voiceId: String(i),
          })),
        }),
      /10 voices/,
    );
    assert.equal(calls.length, 1);
  });
  it("isolates local audio without sending unsupported output format parameters", async () => {
    const calls = mock(audio());
    await run("audio.isolate", { audioPath: source, saveDir: dir });
    assert.equal(calls[0].url, "https://api.elevenlabs.io/v1/audio-isolation");
    assert.ok((calls[0].init.body as FormData).get("audio") instanceof Blob);
  });
  it("supports remote multichannel transcription and repeated keyterms", async () => {
    const output = {
      transcripts: [{ text: "Hi", words: [], channel_index: 0 }],
    };
    const calls = mock(output);
    assert.deepEqual(
      await run("transcription.create", {
        sourceUrl: "https://media.example/audio.wav",
        multiChannel: true,
        channelOutput: "separate",
        timestampsGranularity: "character",
        keyterms: ["Runline", "Eleven Labs"],
      }),
      output,
    );
    const form = calls[0].init.body as FormData;
    assert.equal(form.get("file"), null);
    assert.equal(form.get("source_url"), "https://media.example/audio.wav");
    assert.deepEqual(form.getAll("keyterms"), ["Runline", "Eleven Labs"]);
    assert.equal(form.get("use_multi_channel"), "true");
    for (const input of [
      {},
      { filePath: source, sourceUrl: "https://x.test/a" },
      { sourceUrl: "https://x.test/a", channelOutput: "combined" },
      {
        filePath: source,
        multiChannel: true,
        channelOutput: "combined",
        timestampsGranularity: "none",
      },
      { filePath: source, keyterms: ["a b c d e f"] },
      { sourceUrl: "https://user:password@x.test/a" },
    ])
      await assert.rejects(
        () => run("transcription.create", input),
        /elevenlabs:/,
      );
    assert.equal(calls.length, 1);
  });
  it("recovers history with one GET and uses the downloaded format", async () => {
    for (const [mime, extension] of [
      ["audio/mpeg", ".mp3"],
      ["audio/pcm", ".pcm"],
      ["audio/x-wav", ".wav"],
    ]) {
      const calls = mock(
        new Response(bytes, { headers: { "content-type": mime } }),
      );
      const out = (await run("history.download", {
        historyItemId: "h",
        saveDir: dir,
      })) as { audio: { path: string }; outputFormat: null };
      assert.equal(calls.length, 1);
      assert.equal(
        calls[0].url,
        "https://api.elevenlabs.io/v1/history/h/audio",
      );
      assert.equal(calls[0].init.method, undefined);
      assert.ok(out.audio.path.endsWith(extension));
      assert.equal(out.outputFormat, null);
    }
    mock(
      new Response(bytes, {
        headers: { "content-type": "application/octet-stream" },
      }),
    );
    await assert.rejects(
      () => run("history.download", { historyItemId: "h" }),
      /no identifiable audio format/,
    );
    await assert.rejects(
      () => run("history.download", { historyItemId: "../x" }),
      /invalid history item/,
    );
  });
  it("rejects conflicting audio types across every format-selecting generation path", async () => {
    for (const [name, input] of [
      ["speech.create", { voiceId: "v", text: "hi" }],
      ["speech.convert", { voiceId: "v", audioPath: source }],
      ["dialogue.create", { inputs: [{ voiceId: "v", text: "hi" }] }],
      ["music.create", { prompt: "ambient", durationMs: 3000 }],
      ["sound.create", { text: "rain" }],
    ] as const) {
      let cancelled = false;
      const calls = mock(
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { "content-type": "audio/wav" } },
        ),
      );
      await assert.rejects(
        () => run(name, input),
        /format mismatch.*do not retry/,
      );
      assert.ok(cancelled);
      assert.equal(calls.length, 1);
    }
  });
  it("lists history with provider pagination fields", async () => {
    const output = {
      history: [{ history_item_id: "h" }],
      has_more: true,
      last_history_item_id: "h",
    };
    const calls = mock(output);
    assert.deepEqual(
      await run("history.list", {
        cursor: "previous",
        source: "TTS",
        limit: 5,
      }),
      output,
    );
    const url = new URL(calls[0].url);
    assert.equal(
      url.searchParams.get("start_after_history_item_id"),
      "previous",
    );
    assert.equal(url.searchParams.get("source"), "TTS");
  });
  it("gets and updates saved settings and uses shared multipart voice editing", async () => {
    mock({ stability: 0.5, similarity_boost: 0.75 });
    await run("voices.settings.get", { voiceId: "v" });
    let calls = mock({ status: "ok" });
    await run("voices.settings.update", {
      voiceId: "v",
      settings: { stability: 0 },
    });
    assert.equal(
      calls[0].url,
      "https://api.elevenlabs.io/v1/voices/v/settings/edit",
    );
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), { stability: 0 });
    calls = mock({ status: "ok" });
    await run("voices.update", {
      voiceId: "v",
      name: "Name",
      description: "",
      labels: {},
      audioPaths: [source],
    });
    const form = calls[0].init.body as FormData;
    assert.equal(form.get("description"), "");
    assert.equal(form.getAll("files").length, 1);
    assert.equal(
      Check(action("voices.settings.update").inputSchema as TSchema, {
        voiceId: "v",
        settings: {},
      }),
      false,
    );
  });
  it("lists and creates pronunciation dictionaries with provider rule fields", async () => {
    let calls = mock({
      pronunciation_dictionaries: [
        { id: "d", name: "Names", latest_version_id: "v" },
      ],
      has_more: false,
    });
    await run("pronunciationDictionaries.list", { cursor: "c" });
    assert.equal(new URL(calls[0].url).searchParams.get("cursor"), "c");
    calls = mock({ id: "d", version_id: "v" });
    const rules = [
      { type: "alias", string_to_replace: "Runline", alias: "run line" },
    ];
    await run("pronunciationDictionaries.create", { name: "Names", rules });
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      name: "Names",
      rules,
    });
  });
  it("bounds chunked audio and cancels the reader", async () => {
    let cancelled = false;
    const chunk = new Uint8Array(1024 * 1024);
    mock(
      new Response(
        new ReadableStream({
          pull(c) {
            c.enqueue(chunk);
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "audio/mpeg" } },
      ),
    );
    await assert.rejects(
      () => run("speech.create", { voiceId: "v", text: "hi" }),
      /audio exceeds 100 MiB/,
    );
    assert.ok(cancelled);
  });
});
