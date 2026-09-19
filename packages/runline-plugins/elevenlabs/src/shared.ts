import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { basename } from "node:path";
import * as t from "typebox";
import { Check } from "typebox/value";
import { authedFetch } from "../../_shared/authedFetch.js";
import { SEND_FILE_NOTE, writeMediaFile } from "../../_shared/mediaFile.js";
import {
  obj,
  readBounded,
  readBoundedBytes,
  seg,
} from "../../_shared/provider.js";

export type Ctx = { connection: { config: Record<string, unknown> } };
export const voicePath = (id: string) => seg(id, "voice id", "elevenlabs");
const JSON_LIMIT = 8 * 1024 * 1024;
const AUDIO_LIMIT = 100 * 1024 * 1024;

/** A fixed origin, no redirects or retries, and one deadline through body consumption. */
async function request<T>(
  ctx: Ctx,
  path: string,
  init: RequestInit,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const key = ctx.connection.config.apiKey;
  if (typeof key !== "string" || !key.trim())
    throw new Error("Missing ELEVENLABS_API_KEY");
  let requestId: string | null = null;
  try {
    const response = await authedFetch(`https://api.elevenlabs.io${path}`, {
      ...init,
      headers: {
        "xi-api-key": key.trim(),
        ...(typeof init.body === "string"
          ? { "content-type": "application/json" }
          : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    requestId = response.headers.get("request-id");
    // Both JSON and audio errors use the provider's JSON error envelope.
    if (!response.ok) await json(response);
    return await consume(response);
  } catch (error) {
    const mutation = init.method && init.method !== "GET";
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${requestId ? ` (requestId ${requestId})` : ""}${mutation ? ". Request may have been applied or billed; do not retry automatically." : ""}`,
      { cause: error },
    );
  }
}

async function json(response: Response, limit = JSON_LIMIT): Promise<unknown> {
  const text = await readBounded(
    response,
    limit,
    `elevenlabs: JSON exceeds ${limit / (1024 * 1024)} MiB`,
  );
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`elevenlabs HTTP ${response.status}: non-JSON response`);
  }
  if (!response.ok) {
    const detail = obj(body).detail;
    const error = obj(detail);
    // Include provider error messages and locations, not validation input payloads.
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail
              .map((v) => {
                const e = obj(v);
                return `${Array.isArray(e.loc) ? e.loc.join(".") : "body"}: ${e.msg ?? "invalid"}`;
              })
              .join("; ")
          : `${error.status ?? "request failed"}: ${error.message ?? ""}`;
    throw new Error(
      `elevenlabs HTTP ${response.status}: ${message.slice(0, 1000)}`,
    );
  }
  if (body === null || typeof body !== "object")
    throw new Error("elevenlabs: expected a JSON object or array");
  return body;
}

const id = t.String({ minLength: 1 });
// Validate the fields callers depend on; preserve additional provider metadata.
const voiceResponse = t.Object({ voice_id: id, name: t.String() });
const responses = {
  models: t.Array(t.Object({ model_id: id, name: t.String() })),
  voices: t.Object({
    voices: t.Array(voiceResponse),
    has_more: t.Boolean(),
    next_page_token: t.Optional(t.Union([id, t.Null()])),
  }),
  voice: voiceResponse,
  clone: t.Object({ voice_id: id, requires_verification: t.Boolean() }),
  acknowledgement: t.Object({ status: t.Literal("ok") }),
  transcription: t.Union([
    t.Object({ text: t.String(), words: t.Array(t.Unknown()) }),
    t.Object({
      transcripts: t.Array(
        t.Object({ text: t.String(), words: t.Array(t.Unknown()) }),
        { minItems: 1 },
      ),
    }),
  ]),
  history: t.Object({
    history: t.Array(t.Object({ history_item_id: id })),
    has_more: t.Boolean(),
    last_history_item_id: t.Optional(t.Union([id, t.Null()])),
  }),
  historyItem: t.Object({ history_item_id: id, content_type: t.String() }),
  settings: t.Object({
    stability: t.Optional(t.Union([t.Number(), t.Null()])),
    similarity_boost: t.Optional(t.Union([t.Number(), t.Null()])),
    style: t.Optional(t.Union([t.Number(), t.Null()])),
    speed: t.Optional(t.Union([t.Number(), t.Null()])),
    use_speaker_boost: t.Optional(t.Union([t.Boolean(), t.Null()])),
  }),
  dictionaries: t.Object({
    pronunciation_dictionaries: t.Array(
      t.Object({ id, name: t.String(), latest_version_id: id }),
    ),
    has_more: t.Boolean(),
    next_cursor: t.Optional(t.Union([id, t.Null()])),
  }),
  dictionary: t.Object({ id, version_id: id }),
};

export async function jsonRequest(
  ctx: Ctx,
  path: string,
  expected: keyof typeof responses,
  init: RequestInit = {},
  timeoutMs = 60_000,
) {
  return request(ctx, path, init, timeoutMs, async (response) => {
    const body = await json(response);
    if (!Check(responses[expected], body))
      throw new Error(`elevenlabs: invalid ${expected} response`);
    const cursor = {
      voices: "next_page_token",
      history: "last_history_item_id",
      dictionaries: "next_cursor",
    };
    if (
      expected in cursor &&
      obj(body).has_more &&
      !obj(body)[cursor[expected as keyof typeof cursor]]
    )
      throw new Error("elevenlabs: page is missing its continuation token");
    return body;
  });
}

export interface AudioOptions {
  saveDir?: string;
  timeoutMs?: number;
  outputFormat?: string;
  timestamps?: boolean;
}

const alignment = t.Object({
  characters: t.Array(t.String()),
  character_start_times_seconds: t.Array(t.Number({ minimum: 0 })),
  character_end_times_seconds: t.Array(t.Number({ minimum: 0 })),
});
const alignedAudio = t.Object({
  audio_base64: t.String({
    minLength: 1,
    pattern: "^[A-Za-z0-9+/]*={0,2}$",
  }),
  alignment: t.Optional(t.Union([alignment, t.Null()])),
  normalized_alignment: t.Optional(t.Union([alignment, t.Null()])),
});

/** Requested formats resolve generic headers; explicit audio types must agree. */
function audioMime(format: string | undefined, contentType: string | null) {
  const mime = contentType?.split(";")[0].trim().toLowerCase();
  const supported = [
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
    "audio/opus",
    "audio/x-pcm",
    "audio/pcm",
  ];
  if (mime && mime !== "application/octet-stream" && !supported.includes(mime))
    throw new Error(`elevenlabs: expected audio, received ${mime}`);
  const expected = format?.startsWith("pcm_")
    ? "audio/x-pcm"
    : format?.startsWith("wav_")
      ? "audio/wav"
      : format?.startsWith("opus_")
        ? "audio/ogg"
        : format === "auto" || format?.startsWith("mp3_")
          ? "audio/mpeg"
          : undefined;
  const aliases: Record<string, string> = {
    "audio/mp3": "audio/mpeg",
    "audio/x-wav": "audio/wav",
    "audio/pcm": "audio/x-pcm",
    "audio/opus": "audio/ogg",
  };
  const actual =
    mime && supported.includes(mime) ? (aliases[mime] ?? mime) : undefined;
  if (expected && actual && expected !== actual)
    throw new Error(
      `elevenlabs: audio format mismatch: expected ${expected}, received ${actual}`,
    );
  const resolved = actual ?? expected;
  if (!resolved)
    throw new Error("elevenlabs: response has no identifiable audio format");
  return resolved;
}
export async function audioRequest(
  ctx: Ctx,
  path: string,
  body: Record<string, unknown> | FormData,
  options: AudioOptions,
) {
  const format = options.outputFormat ?? "mp3_44100_128";
  return binaryRequest(
    ctx,
    `${path}?output_format=${encodeURIComponent(format)}`,
    {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body),
    },
    { ...options, outputFormat: format },
  );
}

/** All generated, aligned, isolated, and recovered audio uses the same file writer. */
export async function binaryRequest(
  ctx: Ctx,
  path: string,
  init: RequestInit,
  options: AudioOptions,
) {
  return request(
    ctx,
    path,
    init,
    options.timeoutMs ?? 300_000,
    async (response) => {
      let bytes: Uint8Array;
      let timestamps: Record<string, unknown> = {};
      let mime: string;
      if (options.timestamps) {
        const body = await json(response, 32 * 1024 * 1024);
        if (!Check(alignedAudio, body) || body.audio_base64.length % 4 !== 0)
          throw new Error("elevenlabs: invalid aligned audio response");
        for (const a of [body.alignment, body.normalized_alignment]) {
          if (
            a &&
            (a.characters.length !== a.character_start_times_seconds.length ||
              a.characters.length !== a.character_end_times_seconds.length ||
              a.character_end_times_seconds.some(
                (end, i) => end < a.character_start_times_seconds[i],
              ))
          )
            throw new Error("elevenlabs: invalid alignment lengths or times");
        }
        bytes = Buffer.from(body.audio_base64, "base64");
        timestamps = {
          alignment: body.alignment,
          normalizedAlignment: body.normalized_alignment,
        };
        mime = audioMime(options.outputFormat, null);
      } else {
        try {
          mime = audioMime(
            options.outputFormat,
            response.headers.get("content-type"),
          );
        } catch (error) {
          await response.body?.cancel();
          throw error;
        }
        bytes = await readBoundedBytes(
          response,
          AUDIO_LIMIT,
          "elevenlabs: audio exceeds 100 MiB",
        );
      }
      if (!bytes.length) throw new Error("elevenlabs: empty audio response");
      const audio = writeMediaFile({
        bytes,
        mimeType: mime,
        provider: "elevenlabs",
        index: 0,
        saveDir: options.saveDir,
      });
      return {
        provider: "elevenlabs",
        audio,
        outputFormat: options.outputFormat ?? null,
        requestId: response.headers.get("request-id"),
        songId: response.headers.get("song-id"),
        characterCost: response.headers.get("character-cost"),
        ...timestamps,
        note: SEND_FILE_NOTE,
      };
    },
  );
}

export async function voiceForm(input: {
  name: string;
  audioPaths?: string[];
  description?: string;
  labels?: Record<string, string>;
  removeBackgroundNoise?: boolean;
}) {
  const form = new FormData();
  form.append("name", input.name);
  for (const path of input.audioPaths ?? [])
    await appendFile(form, "files", path);
  if (input.description !== undefined)
    form.append("description", input.description);
  if (input.labels !== undefined)
    form.append("labels", JSON.stringify(input.labels));
  if (input.removeBackgroundNoise !== undefined)
    form.append("remove_background_noise", String(input.removeBackgroundNoise));
  return form;
}

/** Bound uploads before allocating; read through the same handle to avoid stat/read races. */
export async function appendFile(form: FormData, field: string, path: string) {
  // Nonblocking open lets fstat reject FIFOs without waiting for a writer.
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size > 25 * 1024 * 1024)
      throw new Error(
        "elevenlabs: each input must be a nonempty regular file of at most 25 MiB",
      );
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!bytesRead)
        throw new Error("elevenlabs: input file changed while reading");
      offset += bytesRead;
    }
    form.append(field, new Blob([bytes]), basename(path));
  } finally {
    await file.close();
  }
}
