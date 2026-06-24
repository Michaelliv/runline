import type { RunlinePluginAPI } from "runline";
import { buildLocation, extractDocumentId, runBatchUpdate } from "./shared.js";

export function registerImagesActions(rl: RunlinePluginAPI) {
  rl.registerAction("document.insertInlineImage", {
    description:
      "Insert an inline image at the given location. `uri` must point to a publicly fetchable image.",
    inputSchema: {
      document: { type: "string", required: true },
      locationKind: {
        type: "string",
        required: false,
        description:
          "location (default; requires index) | endOfSegmentLocation",
      },
      index: { type: "number", required: false },
      uri: { type: "string", required: true },
      widthPt: { type: "number", required: false },
      heightPt: { type: "number", required: false },
      segmentId: { type: "string", required: false },
      tabId: { type: "string", required: false },
    },
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
          p.tabId as string | undefined
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
    description:
      "Replace an existing image (identified by its inline-object id) with a new image from a publicly fetchable URI.",
    inputSchema: {
      document: { type: "string", required: true },
      imageObjectId: { type: "string", required: true },
      uri: { type: "string", required: true },
      imageReplaceMethod: {
        type: "string",
        required: false,
        description: "CENTER_CROP (default) | (others as Docs API adds them)",
      },
      tabId: { type: "string", required: false },
    },
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
