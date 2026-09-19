import { setTimeout as sleep } from "node:timers/promises";
import * as t from "typebox";
import { Check } from "typebox/value";
import { authedFetch } from "../../_shared/authedFetch.js";
import {
  type SavedMedia,
  SEND_FILE_NOTE,
  writeMediaFile,
} from "../../_shared/mediaFile.js";
import { readBounded, readBoundedBytes, seg } from "../../_shared/provider.js";

export type Ctx = { connection: { config: Record<string, unknown> } };
export const STRICT = { additionalProperties: false } as const;
export const DEFAULT_TIMEOUT_MS = 300_000;
const QUEUE_BASE = "https://queue.fal.run";
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const MAX_JSON_BYTES = 32 * 1024 * 1024;

const receiptSchema = t.Object({
  request_id: t.String({ minLength: 1 }),
  status_url: t.Optional(t.String()),
  response_url: t.Optional(t.String()),
  cancel_url: t.Optional(t.String()),
  queue_position: t.Optional(t.Integer()),
});
const statusSchema = t.Object({
  status: t.Union([
    t.Literal("IN_QUEUE"),
    t.Literal("IN_PROGRESS"),
    t.Literal("COMPLETED"),
  ]),
  error: t.Optional(t.Union([t.String(), t.Null()])),
  error_type: t.Optional(t.Union([t.String(), t.Null()])),
});

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function assertModelId(model: string): string {
  const id = model.trim();
  const parts = id.split("/");
  const namespaced = parts[0] === "workflows" || parts[0] === "comfy";
  if (
    !/^[\w-]+(\/[\w.-]+)+$/.test(id) ||
    parts.some((part) => part === "." || part === "..") ||
    (namespaced && parts.length < 3)
  ) {
    throw new Error(
      "fal: invalid model id; expected owner/model[/variant] or workflows/owner/model[/variant]",
    );
  }
  return id;
}

/** Queue operations address the application, excluding its inference sub-path. */
function queueUrl(model: string, suffix = ""): string {
  const id = assertModelId(model);
  const parts = id.split("/");
  const count = parts[0] === "workflows" || parts[0] === "comfy" ? 3 : 2;
  return `${QUEUE_BASE}/${suffix ? parts.slice(0, count).join("/") : id}${suffix}`;
}

/** Keep validation field names and error types, without echoing model inputs. */
export function explainFalError(status: number, body: unknown): string {
  const data = object(body) ? body : {};
  const detail = data.detail;
  const message = Array.isArray(detail)
    ? detail
        .filter(object)
        .map((entry) => {
          const field = Array.isArray(entry.loc) ? entry.loc.join(".") : "body";
          return `${field}: ${String(entry.msg ?? "invalid")} [${String(entry.type ?? "error")}]`;
        })
        .join("; ")
    : typeof detail === "string"
      ? detail
      : typeof data.status === "string"
        ? data.status
        : "request failed";
  const type =
    typeof data.error_type === "string" ? ` [${data.error_type}]` : "";
  return `fal ${status}: ${message.slice(0, 1000)}${type}`;
}

/** All credential-bearing calls use a fixed origin and refuse redirects. */
async function request(
  ctx: Ctx,
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  const key = ctx.connection.config.apiKey;
  if (typeof key !== "string" || !key.trim())
    throw new Error(
      "Missing FAL_KEY. Create a key at https://fal.ai/dashboard/keys.",
    );
  const response = await authedFetch(url, {
    ...init,
    headers: {
      authorization: `Key ${key.trim()}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    signal: init.signal ?? AbortSignal.timeout(60_000),
  });
  const text = await readBounded(
    response,
    MAX_JSON_BYTES,
    "fal: response exceeds 32 MiB",
  );
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`fal HTTP ${response.status}: non-JSON response`);
  }
  if (!response.ok) throw new Error(explainFalError(response.status, body));
  return body;
}

export async function submit(
  ctx: Ctx,
  model: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
) {
  // A failed POST can have been accepted, so submissions are never retried here.
  const receipt = await request(ctx, queueUrl(model), {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
  if (!Check(receiptSchema, receipt))
    throw new Error(
      "fal: invalid submission receipt or no request id; do not resubmit automatically",
    );
  seg(receipt.request_id, "request id", "fal");
  return receipt;
}

export async function status(
  ctx: Ctx,
  model: string,
  requestId: string,
  logs = false,
  signal?: AbortSignal,
) {
  const body = await request(
    ctx,
    queueUrl(
      model,
      `/requests/${seg(requestId, "request id", "fal")}/status${logs ? "?logs=1" : ""}`,
    ),
    { signal },
  );
  if (!Check(statusSchema, body))
    throw new Error("fal: invalid queue status response");
  return body;
}

export async function result(
  ctx: Ctx,
  model: string,
  requestId: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const body = await request(
    ctx,
    queueUrl(model, `/requests/${seg(requestId, "request id", "fal")}`),
    { signal },
  );
  if (!object(body)) throw new Error("fal: expected an object result");
  return body;
}

export async function cancel(ctx: Ctx, model: string, requestId: string) {
  const body = await request(
    ctx,
    queueUrl(model, `/requests/${seg(requestId, "request id", "fal")}/cancel`),
    { method: "PUT" },
  );
  if (!object(body) || body.status !== "CANCELLATION_REQUESTED")
    throw new Error("fal: cancellation was not confirmed");
  return body;
}

/** One deadline covers submission, polling, and result retrieval, including response bodies. */
export async function runModel(
  ctx: Ctx,
  model: string,
  input: Record<string, unknown>,
  timeoutMs: number,
) {
  const signal = AbortSignal.timeout(timeoutMs);
  let requestId: string | undefined;
  try {
    requestId = (await submit(ctx, model, input, signal)).request_id;
    for (;;) {
      signal.throwIfAborted();
      const current = await status(ctx, model, requestId, false, signal);
      if (current.status === "COMPLETED") {
        if (current.error || current.error_type)
          throw new Error(
            `fal: ${current.error ?? "generation failed"}${current.error_type ? ` [${current.error_type}]` : ""}`,
          );
        return {
          output: await result(ctx, model, requestId, signal),
          requestId,
        };
      }
      await sleep(1000, undefined, { signal });
    }
  } catch (error) {
    const message = signal.aborted
      ? `fal: timed out after ${timeoutMs}ms`
      : error instanceof Error
        ? error.message
        : String(error);
    const recovery = requestId
      ? `Collect with fal.queue.result using model ${model} and requestId ${requestId}; do not submit a replacement automatically.`
      : "Submission may have been accepted; do not resubmit automatically.";
    throw new Error(`${message}. ${recovery}`, { cause: error });
  }
}

export interface MediaRef {
  url: string;
  contentType?: string;
}
type MediaKind = "images" | "videos";
const MEDIA_FIELDS = {
  images: ["images", "image"],
  videos: ["video", "videos"],
  other: ["audio", "audio_url", "file", "files"],
};

/** Only documented top-level media fields are downloaded; other output remains untouched. */
export function collectMedia(
  output: Record<string, unknown>,
  kind?: MediaKind,
): MediaRef[] {
  const found: MediaRef[] = [];
  const seen = new Set<string>();
  const push = (value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      for (const entry of value) push(entry);
      return;
    }
    const url =
      typeof value === "string" ? value : object(value) ? value.url : undefined;
    if (typeof url !== "string" || !url)
      throw new Error("fal: malformed media reference");
    if (seen.has(url)) return;
    seen.add(url);
    found.push({
      url,
      contentType:
        object(value) && typeof value.content_type === "string"
          ? value.content_type
          : undefined,
    });
  };
  for (const field of kind
    ? MEDIA_FIELDS[kind]
    : Object.values(MEDIA_FIELDS).flat())
    push(output[field]);
  return found;
}

/** Restrict automatic downloads to fal's CDN, including every redirect target. */
function mediaUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !(url.hostname === "fal.media" || url.hostname.endsWith(".fal.media"))
  ) {
    throw new Error("fal: automatic downloads require an HTTPS fal.media URL");
  }
  return url;
}

async function download(
  value: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const signal = AbortSignal.timeout(60_000);
  let url = value;
  let response: Response | undefined;
  for (let hops = 0; hops <= 5; hops++) {
    const inline = url.startsWith("data:");
    if (!inline) url = mediaUrl(url).href;
    // No API credential is attached to either CDN or inline media reads.
    response = await fetch(url, {
      signal,
      redirect: "manual",
      credentials: "omit",
    });
    if (response.redirected) {
      await response.body?.cancel();
      throw new Error("fal: media fetch followed an unchecked redirect");
    }
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || hops === 5)
      throw new Error("fal: invalid or excessive media redirects");
    url = mediaUrl(new URL(location, url).href).href;
  }
  if (!response?.ok) {
    await response?.body?.cancel();
    throw new Error(`download failed (${response?.status})`);
  }
  if (Number(response.headers.get("content-length")) > MAX_DOWNLOAD_BYTES) {
    await response.body?.cancel();
    throw new Error("fal: artifact exceeds 512 MiB");
  }
  const bytes = await readBoundedBytes(
    response,
    MAX_DOWNLOAD_BYTES,
    "fal: artifact exceeds 512 MiB",
  );
  if (!bytes.byteLength) throw new Error("fal: empty artifact body");
  return {
    bytes,
    mime: (response.headers.get("content-type") ?? "application/octet-stream")
      .split(";")[0]
      .trim(),
  };
}

/** Shared by generation and queue.result so file handling and partial-failure reporting agree. */
export async function savedResult(
  output: Record<string, unknown>,
  model: string,
  requestId: string,
  saveDir?: string,
  kind?: MediaKind,
) {
  const files: SavedMedia[] = [];
  const failures: { url: string; reason: string }[] = [];
  try {
    const media = collectMedia(output, kind);
    if (kind && !media.length) throw new Error("fal: model returned no media");
    for (const ref of media) {
      try {
        const { bytes, mime } = await download(ref.url);
        files.push(
          writeMediaFile({
            bytes,
            mimeType: ref.contentType ?? mime,
            provider: "fal",
            index: files.length,
            saveDir,
          }),
        );
      } catch (error) {
        failures.push({
          url: ref.url.startsWith("data:") ? "inline media" : ref.url,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (media.length && !files.length)
      throw new Error(
        `fal: none could be downloaded: ${failures.map((f) => f.reason).join("; ")}`,
      );
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}. Retrieve the existing result with model ${model} and requestId ${requestId}; do not regenerate.`,
      { cause: error },
    );
  }
  return {
    provider: "fal",
    model,
    requestId,
    ...(kind
      ? { [kind]: files }
      : { output, ...(files.length ? { files } : {}) }),
    ...(files.length ? { note: SEND_FILE_NOTE } : {}),
    ...(failures.length ? { failures } : {}),
  };
}

export const timeoutSchema = t.Integer({
  minimum: 1000,
  maximum: 3_600_000,
  default: DEFAULT_TIMEOUT_MS,
  description:
    "Queue deadline in milliseconds (default 300000). Includes submission and result retrieval, not downloads (60 seconds per file). Does not cancel server work; use the requestId in the error to collect it.",
});
export const saveDirSchema = t.String({
  description:
    "Existing directory for generated files; defaults to the OS temp directory.",
});
export const extraInputSchema = t.Record(t.String(), t.Unknown(), {
  description:
    "Model-specific fields, overriding action defaults. See https://fal.ai/models/<model>/api. Media downloads support HTTPS fal.media URLs and data URIs, up to 512 MiB each; JSON responses are limited to 32 MiB.",
});
