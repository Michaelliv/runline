import { open } from "node:fs/promises";
import { basename } from "node:path";
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
async function request(
  ctx: Ctx,
  path: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const key = ctx.connection.config.apiKey;
  if (typeof key !== "string" || !key.trim())
    throw new Error("Missing ELEVENLABS_API_KEY");
  return authedFetch(`https://api.elevenlabs.io${path}`, {
    ...init,
    headers: {
      "xi-api-key": key.trim(),
      ...(typeof init.body === "string"
        ? { "content-type": "application/json" }
        : {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
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
    // Do not echo validation inputs, request text, or arbitrary response bodies.
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
  return body;
}

export async function jsonRequest(
  ctx: Ctx,
  path: string,
  init: RequestInit = {},
  timeoutMs = 60_000,
) {
  return json(await request(ctx, path, init, timeoutMs));
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
  let requestId: string | null = null;
  try {
    const format = options.outputFormat ?? "mp3_44100_128";
    const response = await request(
      ctx,
      `${path}?output_format=${encodeURIComponent(format)}`,
      {
        method: "POST",
        body: body instanceof FormData ? body : JSON.stringify(body),
      },
      options.timeoutMs ?? 300_000,
    );
    requestId = response.headers.get("request-id");
    if (!response.ok) {
      await json(response);
      throw new Error("elevenlabs: unexpected error response");
    }
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
      requestId,
      songId: response.headers.get("song-id"),
      note: SEND_FILE_NOTE,
    };
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${requestId ? ` (requestId ${requestId})` : ""}. Generation may have been billed; do not retry automatically.`,
      { cause: error },
    );
  }
}

/** Bound uploads before allocating; read through the same handle to avoid stat/read races. */
export async function appendFile(form: FormData, field: string, path: string) {
  const file = await open(path, "r");
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
