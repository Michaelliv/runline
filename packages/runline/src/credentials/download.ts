import { createHash, randomUUID } from "node:crypto";
import { type FileHandle, open, rename, rm } from "node:fs/promises";
import { AuthError } from "../auth/errors.js";

/**
 * Bytes asked for per request: the transport's default response ceiling,
 * so one range fits whichever signer answers it.
 */
export const DOWNLOAD_RANGE_BYTES = 8 * 1024 * 1024;

/** Requests per range before its failure stands. */
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;
/** Answers that say "try again", not "this request is wrong". */
const RETRY_STATUSES = [429, 500, 502, 503, 504];

export interface DownloadSource {
  /** Names the plugin in errors. */
  plugin: string;
  /**
   * One request for the content with this `Range` header value, answered
   * whatever its status. The same content every time: a signed request,
   * or a provider-issued URL.
   */
  request(range: string): Promise<Response>;
  /** The error for an answer that is not the content. */
  failed(response: Response): Error | Promise<Error>;
}

/** A file to write, or memory up to `maxBytes`, refused beyond it with `oversize`. */
export type DownloadTo =
  | { savePath: string }
  | { maxBytes: number; oversize: string };

export interface DownloadCheck {
  /** The content's MD5 in hex, where the provider states one. */
  md5?: string;
}

export interface Downloaded {
  size: number;
  /** The first answer's headers: the content type, a provider's metadata. */
  headers: Headers;
}

interface Sink {
  write(bytes: Buffer): Promise<void>;
  /** Refuses a total the sink cannot hold, before the rest is requested. */
  expect(total: number): void;
  commit(): Promise<void>;
  discard(): Promise<void>;
}

/**
 * A file that appears at `savePath` only when complete: the bytes go to a
 * sibling temporary file, renamed over the path at the end.
 */
async function fileSink(savePath: string): Promise<Sink> {
  const partial = `${savePath}.${randomUUID()}.part`;
  const file: FileHandle = await open(partial, "wx");
  return {
    async write(bytes) {
      await file.writeFile(bytes);
    },
    expect() {},
    async commit() {
      await file.close();
      await rename(partial, savePath);
    },
    async discard() {
      await file.close().catch(() => {});
      await rm(partial, { force: true });
    },
  };
}

function memorySink(
  limit: { maxBytes: number; oversize: string },
  chunks: Buffer[],
): Sink {
  let size = 0;
  const expect = (total: number) => {
    if (total > limit.maxBytes) throw new Error(limit.oversize);
  };
  return {
    async write(bytes) {
      size += bytes.byteLength;
      expect(size);
      chunks.push(bytes);
    },
    expect,
    async commit() {},
    async discard() {},
  };
}

/** One range's answer, asked again while the failure is one that passes. */
async function answer(
  source: DownloadSource,
  range: string,
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const last = attempt === ATTEMPTS;
    try {
      const response = await source.request(range);
      if (last || !RETRY_STATUSES.includes(response.status)) return response;
    } catch (error) {
      if (last || (error as { code?: unknown }).code !== "transport_failed")
        throw error;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, RETRY_DELAY_MS * attempt),
    );
  }
}

/** A 206's `Content-Range`: the bytes it carries and the content's total, when stated. */
function contentRange(
  response: Response,
): { start: number; end: number; total?: number } | undefined {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(
    response.headers.get("content-range") ?? "",
  );
  if (!match) return undefined;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    ...(match[3] === "*" ? {} : { total: Number(match[3]) }),
  };
}

/**
 * Content of any size, fetched as consecutive byte ranges (RFC 9110
 * section 14), so no single answer outgrows a signer's response ceiling
 * or its deadline, and a failed range is asked again without the rest.
 *
 * A server that ignores `Range` answers 200 with the whole content, which
 * is taken as it is. Content that changes between ranges is refused: by
 * a total that moves, and by `check.md5` where the provider states one.
 * A file is written beside `savePath` and renamed over it when complete,
 * so a failed download leaves nothing there.
 */
export async function rangedDownload(
  source: DownloadSource,
  to: { savePath: string },
  check?: DownloadCheck,
): Promise<Downloaded>;
export async function rangedDownload(
  source: DownloadSource,
  to: { maxBytes: number; oversize: string },
  check?: DownloadCheck,
): Promise<Downloaded & { bytes: Buffer }>;
export async function rangedDownload(
  source: DownloadSource,
  to: DownloadTo,
  check?: DownloadCheck,
): Promise<Downloaded & { bytes?: Buffer }>;
export async function rangedDownload(
  source: DownloadSource,
  to: DownloadTo,
  check: DownloadCheck = {},
): Promise<Downloaded & { bytes?: Buffer }> {
  const chunks: Buffer[] = [];
  const sink =
    "savePath" in to ? await fileSink(to.savePath) : memorySink(to, chunks);
  const hash = check.md5 === undefined ? undefined : createHash("md5");
  try {
    let offset = 0;
    let total: number | undefined;
    let first: Response | undefined;
    for (let done = false; !done; ) {
      const response = await answer(
        source,
        `bytes=${offset}-${offset + DOWNLOAD_RANGE_BYTES - 1}`,
      );
      first ??= response;
      // Nothing at or past the offset: empty content, or the end of
      // content whose total was never stated.
      if (response.status === 416) {
        const empty = response.headers.get("content-range") === "bytes */0";
        if (offset === 0 ? !empty : total !== undefined)
          throw await source.failed(response);
        break;
      }
      if (response.status !== 200 && response.status !== 206)
        throw await source.failed(response);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (response.status === 200) {
        if (offset > 0) throw new AuthError("invalid_response");
        done = true;
      } else {
        const range = contentRange(response);
        if (
          !range ||
          range.start !== offset ||
          range.end - range.start + 1 !== bytes.byteLength ||
          !bytes.byteLength
        )
          throw new AuthError("invalid_response");
        if (total !== undefined && range.total !== total)
          throw new Error(
            `${source.plugin}: the content changed while downloading`,
          );
        total = range.total;
        if (total !== undefined) sink.expect(total);
        done =
          total === undefined
            ? bytes.byteLength < DOWNLOAD_RANGE_BYTES
            : range.end + 1 >= total;
      }
      await sink.write(bytes);
      hash?.update(bytes);
      offset += bytes.byteLength;
    }
    if (hash && hash.digest("hex") !== check.md5?.toLowerCase())
      throw new Error(
        `${source.plugin}: the download does not match the content's checksum`,
      );
    await sink.commit();
    return {
      size: offset,
      headers: (first as Response).headers,
      ...("savePath" in to ? {} : { bytes: Buffer.concat(chunks) }),
    };
  } catch (error) {
    await sink.discard();
    throw error;
  }
}
