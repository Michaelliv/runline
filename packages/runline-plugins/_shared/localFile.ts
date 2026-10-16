import { constants } from "node:fs";
import { open } from "node:fs/promises";

/**
 * A file on the runline host that an action input names — an attachment,
 * an upload, an image to edit — read as one bounded buffer. It must be a
 * regular file: the nonblocking open lets fstat refuse a FIFO or device
 * without waiting on a writer. The size is checked before allocation and
 * the bytes are read through the same handle, so a file swapped or grown
 * between the check and the read cannot slip past the bound.
 */
export async function readLocalFile(
  path: string,
  options: {
    /** What errors call the file, in the caller's words (`fal: imagePath`, `File`). */
    subject: string;
    maxBytes: number;
    /** The error when the file exceeds `maxBytes`, with the caller's remedy. */
    oversize: string;
  },
): Promise<Buffer<ArrayBuffer>> {
  const { subject } = options;
  let file: Awaited<ReturnType<typeof open>>;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    throw new Error(
      `${subject} is unreadable${typeof code === "string" ? ` (${code})` : ""}`,
    );
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error(`${subject} must be a regular file`);
    if (stat.size > options.maxBytes) throw new Error(options.oversize);
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!bytesRead) throw new Error(`${subject} changed while reading`);
      offset += bytesRead;
    }
    return bytes;
  } finally {
    await file.close();
  }
}
