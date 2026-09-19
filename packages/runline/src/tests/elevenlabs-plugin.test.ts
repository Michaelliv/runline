import assert from "node:assert/strict";
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
    },
  });
}

describe("elevenlabs plugin", () => {
  it("registers the official node baseline plus models, music and sound", () => {
    assert.deepEqual(plugin.actions.map((a) => a.name).sort(), [
      "models.list",
      "music.create",
      "sound.create",
      "speech.convert",
      "speech.create",
      "transcription.create",
      "voices.clone",
      "voices.delete",
      "voices.get",
      "voices.list",
    ]);
    for (const a of plugin.actions)
      assert.equal(
        a.access,
        ["models.list", "voices.get", "voices.list"].includes(a.name)
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
        outputFormat: "pcm_8000",
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
  it("uses GET and DELETE on the same voice path and accepts empty 204", async () => {
    let calls = mock({ voice_id: "v" });
    await run("voices.get", { voiceId: "v" });
    assert.equal(calls[0].url, "https://api.elevenlabs.io/v1/voices/v");
    calls = mock(new Response(null, { status: 204 }));
    await run("voices.delete", { voiceId: "v" });
    assert.equal(calls[0].init.method, "DELETE");
  });
  it("rejects unsafe voice IDs on all voice-specific actions", async () => {
    const calls = mock();
    for (const name of [
      "voices.get",
      "voices.delete",
      "speech.create",
      "speech.convert",
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
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      prompt: "ambient",
      music_length_ms: 10000,
      force_instrumental: true,
      model_id: "music_v2",
    });
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
        /empty audio|expected MP3/,
      );
    }
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
