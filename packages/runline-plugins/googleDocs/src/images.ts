import type { RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { STRICT } from "../../_shared/schemas.js";
import {
  buildLocation,
  DocumentInput,
  extractDocumentId,
  LOCATION_REQUIREMENT,
  LocationInput,
  PositivePoints,
  points,
  runBatchUpdate,
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
      { ...STRICT, anyOf: LOCATION_REQUIREMENT },
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      const req: Record<string, unknown> = {
        ...buildLocation(p),
        uri: p.uri,
      };
      if (p.widthPt !== undefined || p.heightPt !== undefined) {
        req.objectSize = {};
        if (p.widthPt !== undefined)
          (req.objectSize as Record<string, unknown>).width = points(p.widthPt);
        if (p.heightPt !== undefined)
          (req.objectSize as Record<string, unknown>).height = points(
            p.heightPt,
          );
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
      STRICT,
    ),
    async execute(p, ctx) {
      const documentId = extractDocumentId(p.document);
      return runBatchUpdate(ctx, documentId, [
        {
          replaceImage: {
            imageObjectId: p.imageObjectId,
            uri: p.uri,
            imageReplaceMethod: p.imageReplaceMethod ?? "CENTER_CROP",
            ...(p.tabId ? { tabId: p.tabId } : {}),
          },
        },
      ]);
    },
  });
}
