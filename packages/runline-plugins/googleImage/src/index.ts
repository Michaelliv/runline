/**
 * Google Gemini image generation (Nano Banana / Imagen) for runline.
 *
 * Distinct from the rest of the googleX family — those wrap Workspace
 * APIs over OAuth2, this one wraps Generative Language over a single
 * API key. Kept under the `googleImage` namespace so it doesn't
 * collide with `googleDrive`, `googleDocs`, etc.
 *
 *   const { images } = await googleImage.image.create({ prompt: "a watercolor fox" })
 *   // images[0].path -> "/tmp/googleImage-….png"
 *
 * Generated images are written to disk and the action returns their file
 * `path`s — never raw base64, which bloats the agent context and is
 * stripped before delivery. Hand each `path` to the host's file-sending
 * tool (e.g. send_file) to deliver the image.
 *
 * Nano Banana is strong at editing — `image.edit` sends a local image
 * inline next to the instruction and writes the edited result to disk.
 */

import type { ActionContext, RunlinePluginAPI } from "runline";
import * as t from "typebox";
import { credentialJson, pathSegment } from "../../_shared/credentials.js";
import {
  readImageInput,
  type SavedMedia,
  SEND_FILE_NOTE,
  writeImageFile,
} from "../../_shared/mediaFile.js";
import { googleImageCredential } from "./credentials.js";

/** The model as one path segment before the fixed :generateContent verb. */
function generateContent(
  ctx: ActionContext,
  model: string,
  body: Record<string, unknown>,
): Promise<GeminiResponse> {
  return credentialJson(ctx, googleImageCredential, "googleImage", {
    target: "api",
    path: `models/${pathSegment(model)}:generateContent`,
    method: "POST",
    json: body,
  }) as Promise<GeminiResponse>;
}

interface CreateInput {
  prompt: string;
  model?: string;
  saveDir?: string;
}

interface EditInput {
  prompt: string;
  imagePath: string;
  model?: string;
  saveDir?: string;
}

interface GeminiPart {
  inlineData?: { data: string; mimeType?: string };
  text?: string;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
}

/** Write every inline image part of a Gemini response to disk. */
function saveInlineImages(
  data: GeminiResponse,
  saveDir: string | undefined,
): SavedMedia[] {
  const stamp = Date.now();
  const images: SavedMedia[] = [];
  for (const candidate of data.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.data) {
        images.push(
          writeImageFile({
            base64: part.inlineData.data,
            mimeType: part.inlineData.mimeType ?? "image/png",
            provider: "googleImage",
            index: images.length,
            saveDir,
            stamp,
          }),
        );
      }
    }
  }
  return images;
}

export default function googleImage(rl: RunlinePluginAPI) {
  rl.setName("googleImage");
  rl.setVersion("0.1.0");
  rl.setCredential(googleImageCredential);

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Google AI API key (Gemini)",
      env: "GOOGLE_API_KEY",
    },
  });

  rl.registerAction("image.create", {
    access: "write",
    description:
      "Generate an image with Google's Gemini image models (Nano Banana / Imagen). Writes the image(s) to disk and returns their file `path`s — not base64. Deliver each image to the user with send_file using its `path`.",
    inputSchema: t.Object(
      {
        prompt: t.String({
          minLength: 1,
          description: "Detailed description of the image",
        }),
        model: t.Optional(
          t.String({
            minLength: 1,
            description:
              "Gemini image model ID. Defaults to gemini-2.5-flash-image.",
          }),
        ),
        saveDir: t.Optional(
          t.String({
            description:
              "Directory to write the image file(s) into. Empty or omitted uses the OS temp directory.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as CreateInput;
      if (typeof p.prompt !== "string" || p.prompt.length === 0) {
        throw new Error("googleImage: prompt is required");
      }

      const model = p.model ?? "gemini-2.5-flash-image";
      const data = await generateContent(ctx, model, {
        contents: [{ parts: [{ text: p.prompt }] }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      });
      const images = saveInlineImages(data, p.saveDir);
      return { provider: "googleImage", model, images, note: SEND_FILE_NOTE };
    },
  });

  rl.registerAction("image.edit", {
    access: "write",
    description:
      "Edit a local image with Gemini (Nano Banana): give the file path and describe the change. Sends the image inline with the instruction, writes the edited image(s) to disk, and returns their file `path`s — not base64. Deliver each with send_file using its `path`.",
    inputSchema: t.Object(
      {
        prompt: t.String({
          minLength: 1,
          description: "Instruction describing the edit to apply",
        }),
        imagePath: t.String({
          minLength: 1,
          description: "Path to the source image file",
        }),
        model: t.Optional(
          t.String({
            minLength: 1,
            description:
              "Gemini image model ID. Defaults to gemini-2.5-flash-image.",
          }),
        ),
        saveDir: t.Optional(
          t.String({
            description:
              "Directory to write the image file(s) into. Empty or omitted uses the OS temp directory.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(input, ctx) {
      const p = (input ?? {}) as EditInput;
      if (typeof p.prompt !== "string" || p.prompt.length === 0) {
        throw new Error("googleImage: prompt is required");
      }
      const img = readImageInput(p.imagePath, "googleImage");

      const model = p.model ?? "gemini-2.5-flash-image";
      const data = await generateContent(ctx, model, {
        contents: [
          {
            parts: [
              { text: p.prompt },
              { inlineData: { mimeType: img.mimeType, data: img.base64 } },
            ],
          },
        ],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      });
      const images = saveInlineImages(data, p.saveDir);
      if (images.length === 0) {
        throw new Error(
          "googleImage: the model returned no edited image — it may have refused; try a more specific instruction",
        );
      }
      return { provider: "googleImage", model, images, note: SEND_FILE_NOTE };
    },
  });
}
