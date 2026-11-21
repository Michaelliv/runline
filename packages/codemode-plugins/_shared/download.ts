import type { DownloadTo } from "@shiftlabs/codemode";

/** The most a download answers as base64; larger content is written to a savePath. */
const INLINE_BYTES = 64 * 1024 * 1024;

/**
 * Where an action's download goes: the caller's `savePath`, at any size,
 * or memory when there is none, up to what an action answers as base64.
 */
export function downloadTo(
  plugin: string,
  savePath: string | undefined,
): DownloadTo {
  return savePath === undefined
    ? {
        maxBytes: INLINE_BYTES,
        oversize: `${plugin}: the file exceeds 64 MiB; pass savePath to write it to disk`,
      }
    : { savePath };
}
