import { basename } from "node:path";
import * as t from "typebox";
import { DownloadedFile, standardBase64 } from "./base64.js";
import { readLocalFile } from "./localFile.js";

const STRICT = { additionalProperties: false } as const;
const id = t.String({ minLength: 1, pattern: "\\S" });

/** What any attachment may say about itself, whatever its bytes are. */
export const attachmentMetadata = {
  name: t.Optional(
    t.String({ ...id, description: "File name; defaults to the path's name." }),
  ),
  mimeType: t.Optional(
    t.String({ ...id, description: "MIME type, e.g. application/pdf." }),
  ),
  inline: t.Optional(
    t.Boolean({
      description:
        "Embed in the HTML body, referenced as cid:<contentId>, instead of attaching.",
    }),
  ),
  contentId: t.Optional(
    t.String({ ...id, description: "Content-ID for inline images." }),
  ),
};

/**
 * An attachment's bytes, given one way each and named as gmail and
 * googleDrive name them: `contentBase64` (base64, or a
 * googleDrive.file.download result passed straight through),
 * `contentPath` (a file on the runline host) or `content` (UTF-8 text).
 * `sizeNote` states the plugin's own limit.
 */
export function attachmentSources(sizeNote: string) {
  return [
    t.Object(
      {
        ...attachmentMetadata,
        contentBase64: t.Union([t.String(), DownloadedFile], {
          description: `Base64 bytes (standard or base64url; padding and whitespace normalized), or a googleDrive.file.download result, whose name and mimeType are used when not given here. ${sizeNote}`,
        }),
      },
      STRICT,
    ),
    t.Object(
      {
        ...attachmentMetadata,
        contentPath: t.String({
          ...id,
          description: `A regular file on the runline host, read at call time. ${sizeNote}`,
        }),
      },
      STRICT,
    ),
    t.Object(
      {
        ...attachmentMetadata,
        content: t.String({
          description: `UTF-8 text content, e.g. a generated CSV. ${sizeNote}`,
        }),
      },
      STRICT,
    ),
  ] as const;
}

type Metadata = t.Static<t.TObject<typeof attachmentMetadata>>;
export type AttachmentInput = Metadata &
  (
    | { contentBase64: string | t.Static<typeof DownloadedFile> }
    | { contentPath: string }
    | { content: string }
  );

/** An attachment's bytes, and the name and type it carries or implies. */
export interface AttachmentFile {
  bytes: Buffer;
  name?: string;
  mimeType?: string;
}

/**
 * Bytes given as base64, or as a googleDrive.file.download result, which
 * also supplies a name and type. `subject` names the input in errors
 * (`gmail: attachment 0`).
 */
export function base64File(
  value: string | t.Static<typeof DownloadedFile>,
  subject: string,
): AttachmentFile {
  const result = typeof value === "string" ? undefined : value;
  const content = standardBase64(
    typeof value === "string" ? value : value.contentBase64,
  );
  if (content === undefined)
    throw new Error(`${subject} contentBase64 is not valid base64`);
  return {
    bytes: Buffer.from(content, "base64"),
    name: result?.name || undefined,
    mimeType: result?.mimeType || undefined,
  };
}

/**
 * An attachment input's bytes. A download result passed as contentBase64
 * supplies the name and type the input leaves out; a local file is named
 * for its path; text is text/plain. Oversized bytes, invalid base64 and
 * unreadable files are refused here, before any request.
 */
export async function attachmentFile(
  input: AttachmentInput,
  index: number,
  limits: { plugin: string; maxBytes: number; oversize: string },
): Promise<AttachmentFile> {
  const subject = `${limits.plugin}: attachment ${index}`;
  let file: AttachmentFile;
  if ("contentBase64" in input) {
    file = base64File(input.contentBase64, subject);
  } else if ("contentPath" in input) {
    file = {
      bytes: await readLocalFile(input.contentPath, {
        subject: `${subject} contentPath`,
        maxBytes: limits.maxBytes,
        oversize: limits.oversize,
      }),
      name: basename(input.contentPath),
    };
  } else {
    file = {
      bytes: Buffer.from(input.content, "utf8"),
      mimeType: "text/plain",
    };
  }
  if (file.bytes.length > limits.maxBytes) throw new Error(limits.oversize);
  return {
    bytes: file.bytes,
    name: input.name ?? file.name,
    mimeType: input.mimeType ?? file.mimeType,
  };
}
