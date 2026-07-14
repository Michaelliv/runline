import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import {
  buildLocation,
  DocumentInput,
  extractDocumentId,
  LOCATION_REQUIREMENT,
  LocationInput,
  PositivePoints,
  runBatchUpdate,
  STRICT_OBJECT,
} from "./shared.js";

const PublicImageUri = t.String({
  minLength: 1,
  pattern: "^https?://",
  description: "Publicly fetchable HTTP(S) image URI",
});

export function registerImagesActions(rl: RunlinePluginAPI) {
  rl.registerAction("document.insertInlineImage", {
    access: "write",
    description:
      "Insert an inline image at the given location. `uri` must point to a publicly fetchable image.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        ...LocationInput,
        uri: PublicImageUri,
        widthPt: t.Optional(PositivePoints),
        heightPt: t.Optional(PositivePoints),
      },
      { ...STRICT_OBJECT, anyOf: LOCATION_REQUIREMENT },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      const pt = (n: unknown) => ({ magnitude: n, unit: "PT" });
      const kind =
        (p.locationKind as "location" | "endOfSegmentLocation") ?? "location";
      const req: Record<string, unknown> = {
        ...buildLocation(
          kind,
          p.segmentId as string,
          p.index as number,
          p.tabId as string | undefined,
        ),
        uri: p.uri,
      };
      if (p.widthPt !== undefined || p.heightPt !== undefined) {
        req.objectSize = {};
        if (p.widthPt !== undefined)
          (req.objectSize as Record<string, unknown>).width = pt(p.widthPt);
        if (p.heightPt !== undefined)
          (req.objectSize as Record<string, unknown>).height = pt(p.heightPt);
      }
      return runBatchUpdate(ctx, documentId, [{ insertInlineImage: req }]);
    },
  });

  rl.registerAction("document.replaceImage", {
    access: "write",
    description:
      "Replace an existing image (identified by its inline-object id) with a new image from a publicly fetchable URI.",
    inputSchema: t.Object(
      {
        ...DocumentInput,
        imageObjectId: t.String({ minLength: 1 }),
        uri: PublicImageUri,
        imageReplaceMethod: t.Optional(t.Literal("CENTER_CROP")),
        tabId: t.Optional(t.String({ minLength: 1 })),
      },
      STRICT_OBJECT,
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as Record<string, unknown>;
      const documentId = extractDocumentId(p.document as string);
      return runBatchUpdate(ctx, documentId, [
        {
          replaceImage: {
            imageObjectId: p.imageObjectId,
            uri: p.uri,
            imageReplaceMethod:
              (p.imageReplaceMethod as string | undefined) ?? "CENTER_CROP",
            ...(p.tabId ? { tabId: p.tabId } : {}),
          },
        },
      ]);
    },
  });
}
