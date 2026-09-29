import { setTimeout as sleep } from "node:timers/promises";
import type { ActionContext, HttpMethod } from "runline";
import * as t from "typebox";
import { Check } from "typebox/value";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import {
  type SavedMedia,
  SEND_FILE_NOTE,
  writeMediaFile,
} from "../../_shared/mediaFile.js";
import { readBoundedBytes } from "../../_shared/provider.js";
import { falCredential } from "./credentials.js";

export type Ctx = ActionContext;
export const STRICT = { additionalProperties: false } as const;
export const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;

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
function queuePath(model: string, suffix = ""): string {
  const id = assertModelId(model);
  const parts = id.split("/");
  const count = parts[0] === "workflows" || parts[0] === "comfy" ? 3 : 2;
  return `${suffix ? parts.slice(0, count).join("/") : id}${suffix}`;
}

/**
 * All credential-bearing calls go through the queue target; the transport
 * pins the origin and refuses redirects. Failures are reported by status
 * alone, without echoing provider text.
 */
async function request(
  ctx: Ctx,
  path: string,
  init: { method?: HttpMethod; json?: unknown } = {},
): Promise<unknown> {
  const key = ctx.connection.config.apiKey;
  if (!ctx.credentials && (typeof key !== "string" || !key.trim()))
    throw new Error(
      "Missing FAL_KEY. Create a key at https://fal.ai/dashboard/keys.",
    );
  return credentialJson(ctx, falCredential, "fal", {
    target: "queue",
    path,
    method: init.method ?? "GET",
    // Every queue call declares a JSON body type, even bodyless GETs.
    headers: { "Content-Type": "application/json" },
    ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
  });
}

/** The queue deadline stops the wait; the transport bounds the request itself. */
function raceSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  // The transport settles the abandoned request on its own; its rejection is handled here.
  promise.catch(() => {});
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export async function submit(
  ctx: Ctx,
  model: string,
  input: Record<string, unknown>,
) {
  // A failed POST can have been accepted, so submissions are never retried here.
  const receipt = await request(ctx, queuePath(model), {
    method: "POST",
    json: input,
  });
  if (!Check(receiptSchema, receipt))
    throw new Error(
      "fal: invalid submission receipt or no request id; do not resubmit automatically",
    );
  pathSegment(receipt.request_id);
  return receipt;
}

export async function status(
  ctx: Ctx,
  model: string,
  requestId: string,
  logs = false,
) {
  const body = await request(
    ctx,
    queuePath(
      model,
      `/requests/${pathSegment(requestId)}/status${logs ? "?logs=1" : ""}`,
    ),
  );
  if (!Check(statusSchema, body))
    throw new Error("fal: invalid queue status response");
  return body;
}

export async function result(
  ctx: Ctx,
  model: string,
  requestId: string,
): Promise<Record<string, unknown>> {
  const body = await request(
    ctx,
    queuePath(model, `/requests/${pathSegment(requestId)}`),
  );
  if (!object(body)) throw new Error("fal: expected an object result");
  return body;
}

export async function cancel(ctx: Ctx, model: string, requestId: string) {
  const body = await request(
    ctx,
    queuePath(model, `/requests/${pathSegment(requestId)}/cancel`),
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
    requestId = (await raceSignal(submit(ctx, model, input), signal))
      .request_id;
    for (;;) {
      signal.throwIfAborted();
      const current = await raceSignal(
        status(ctx, model, requestId, false),
        signal,
      );
      if (current.status === "COMPLETED") {
        if (current.error || current.error_type)
          throw new Error(
            `fal: ${current.error ?? "generation failed"}${current.error_type ? ` [${current.error_type}]` : ""}`,
          );
        return {
          output: await raceSignal(result(ctx, model, requestId), signal),
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

/**
 * Restrict automatic downloads to fal's CDN, including every redirect target.
 * These reads carry no credential, so they do not use the broker:
 * redirects are followed manually, each hop re-validated here.
 */
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
    "Model-specific fields, overriding action defaults. See https://fal.ai/models/<model>/api. Media downloads support HTTPS fal.media URLs and data URIs, up to 512 MiB each; JSON responses are limited to 64 MiB.",
});
