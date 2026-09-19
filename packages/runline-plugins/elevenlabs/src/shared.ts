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

async function json(response: Response): Promise<unknown> {
  const text = await readBounded(
    response,
    JSON_LIMIT,
    "elevenlabs: JSON exceeds 8 MiB",
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
  deletion: t.Object({ status: t.Literal("ok") }),
  transcription: t.Object({ text: t.String(), words: t.Array(t.Unknown()) }),
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
    if (
      expected === "voices" &&
      obj(body).has_more &&
      !obj(body).next_page_token
    )
      throw new Error(
        "elevenlabs: voice page is missing its continuation token",
      );
    return body;
  });
}

export interface AudioOptions {
  saveDir?: string;
  timeoutMs?: number;
  outputFormat?: string;
}
export async function audioRequest(
  ctx: Ctx,
  path: string,
  body: Record<string, unknown> | FormData,
  options: AudioOptions,
) {
  const format = options.outputFormat ?? "mp3_44100_128";
  return request(
    ctx,
    `${path}?output_format=${encodeURIComponent(format)}`,
    {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body),
    },
    options.timeoutMs ?? 300_000,
    async (response) => {
      const mime = response.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase();
      if (
        mime &&
        !["audio/mpeg", "audio/mp3", "application/octet-stream"].includes(mime)
      ) {
        await response.body?.cancel();
        throw new Error(`elevenlabs: expected MP3 audio, received ${mime}`);
      }
      const bytes = await readBoundedBytes(
        response,
        AUDIO_LIMIT,
        "elevenlabs: audio exceeds 100 MiB",
      );
      if (!bytes.length) throw new Error("elevenlabs: empty audio response");
      const audio = writeMediaFile({
        bytes,
        mimeType: "audio/mpeg",
        provider: "elevenlabs",
        index: 0,
        saveDir: options.saveDir,
      });
      return {
        provider: "elevenlabs",
        audio,
        requestId: response.headers.get("request-id"),
        songId: response.headers.get("song-id"),
        characterCost: response.headers.get("character-cost"),
        note: SEND_FILE_NOTE,
      };
    },
  );
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
