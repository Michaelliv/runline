import * as t from "typebox";

/**
 * Caller-supplied base64 in the standard padded alphabet: whitespace
 * dropped, base64url's `-` and `_` mapped to `+` and `/`, padding
 * restored. So a gmail.message.getAttachment result (base64url, unpadded)
 * and a googleDrive download (standard) are equally accepted. Undefined
 * when the value is not base64: a character outside both alphabets,
 * padding anywhere but the end, or a length no encoding produces.
 *
 * Flat character-class patterns only: values run to many megabytes.
 */
export function standardBase64(value: string): string | undefined {
  const compact = value.replace(/\s+/g, "").replace(/={1,2}$/, "");
  if (!/^[A-Za-z0-9+/_-]*$/.test(compact) || compact.length % 4 === 1)
    return undefined;
  const standard = compact.replace(/-/g, "+").replace(/_/g, "/");
  return standard.padEnd(Math.ceil(standard.length / 4) * 4, "=");
}

/**
 * A googleDrive.file.download result, accepted wherever attachment bytes
 * are: exactly its fields, so the result passes through unedited while
 * anything else is still refused. Its `name` and `mimeType` stand in for
 * an attachment's own when those are left out.
 */
export const DownloadedFile = t.Object(
  {
    contentBase64: t.String(),
    name: t.Optional(t.String()),
    mimeType: t.Optional(t.String()),
    size: t.Optional(t.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
