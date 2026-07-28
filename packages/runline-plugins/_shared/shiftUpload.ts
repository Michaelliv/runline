import { openAsBlob } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

/**
 * The Shift cloud signed-grant upload arc, shared by every plugin that
 * moves local file bytes into the cloud (shiftTranscription assets,
 * shiftObjects objects): stat + size-gate the file, create the server
 * record with { contentType, sizeBytes }, PUT the bytes to the grant
 * URL with the grant's headers, then POST /complete. The subtle parts
 * live here once: the openAsBlob streaming fallback, grant-header
 * merging, and the size ceilings.
 *
 * shiftOcr deliberately does not use this arc — it inlines small files
 * as base64 data URLs instead of uploading through a grant.
 */

/** Mirrors the public service contracts' 5 GiB upload ceiling. */
export const SIGNED_UPLOAD_MAX_BYTES = 5 * 1024 * 1024 * 1024;

/**
 * Runtimes without fs.openAsBlob fall back to buffering; refuse to
 * buffer files that would strain the host process.
 */
const MAX_BUFFERED_BYTES = 512 * 1024 * 1024;

/** Audio and video formats the transcription service accepts. */
export const AUDIO_VIDEO_MEDIA_TYPES: Record<string, string> = {
  aac: "audio/aac",
  flac: "audio/flac",
  m4a: "audio/m4a",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  wave: "audio/wav",
  webm: "video/webm",
};

/** Common document, image, and media formats for durable objects. */
export const GENERAL_MEDIA_TYPES: Record<string, string> = {
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  md: "text/markdown",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
  txt: "text/plain",
  wav: "audio/wav",
  webp: "image/webp",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
};

/** The upload half of a create response: where and how to PUT bytes. */
export interface SignedUploadGrant {
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

/** Extension-based media type lookup; undefined when unknown. */
export function mediaTypeFromPath(
  path: string,
  types: Record<string, string>,
): string | undefined {
  return types[extname(path).slice(1).toLowerCase()];
}

/** Like {@link mediaTypeFromPath}, but unknown extensions are an error. */
export function requireMediaType(
  path: string,
  types: Record<string, string>,
): string {
  const mediaType = mediaTypeFromPath(path, types);
  if (!mediaType) {
    throw new Error(
      `Unsupported media extension for ${path}. Supported: ${Object.keys(types).join(", ")}`,
    );
  }
  return mediaType;
}

/**
 * Gate a local file before any network call: it must exist, be a real
 * file, be non-empty, and fit the service ceiling. Returns its size.
 * The label keeps each plugin's established error vocabulary
 * ("File is empty" vs "Media file is empty").
 */
export async function statUploadFile(
  path: string,
  maxBytes: number,
  label = "File",
): Promise<number> {
  const file = await stat(path);
  if (!file.isFile()) throw new Error(`${path} is not a file`);
  if (file.size === 0) throw new Error(`${label} is empty`);
  if (file.size > maxBytes) {
    throw new Error(`${label} is larger than the ${maxBytes}-byte service limit`);
  }
  return file.size;
}

async function fileBody(
  path: string,
  sizeBytes: number,
): Promise<Blob | Buffer> {
  try {
    return await openAsBlob(path);
  } catch {
    if (sizeBytes > MAX_BUFFERED_BYTES) {
      throw new Error(
        "This runtime cannot stream uploads and the file is too large to buffer.",
      );
    }
    return await readFile(path);
  }
}

/**
 * PUT a local file's bytes to a signed grant. Grant headers win;
 * content-type is filled in only when the grant leaves it unset.
 */
export async function putThroughGrant(
  grant: SignedUploadGrant,
  path: string,
  contentType: string,
  sizeBytes: number,
  label = "Upload",
): Promise<void> {
  const headers = new Headers(grant.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", contentType);
  }
  const response = await fetch(grant.url, {
    method: grant.method,
    headers,
    body: await fileBody(path, sizeBytes),
  });
  if (!response.ok) {
    throw new Error(`${label} failed: HTTP ${response.status}`);
  }
}
