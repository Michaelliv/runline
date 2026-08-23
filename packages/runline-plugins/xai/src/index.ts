/**
 * xAI image generation (Grok Imagine / Aurora) for runline.
 *
 *   await xai.image.create({ prompt: "ultra-realistic close-up of a dragonfly" })
 *   await xai.image.create({ prompt: "movie poster", aspectRatio: "9:16" })
 *
 * Aurora leans photorealistic and handles real-world entities and
 * text rendering well. Sized via aspect_ratio rather than W×H —
 * the API does the math.
 */

import type { RunlinePluginAPI } from "runline";
import { readImageInput, SEND_FILE_NOTE, writeImageFile } from "../../_shared/imageFile.js";

const ENDPOINT = "https://api.x.ai/v1/images/generations";
const EDIT_ENDPOINT = "https://api.x.ai/v1/images/edits";
const MODEL = "grok-imagine-image";
const EDIT_MODEL = "grok-imagine-image-2.0";

interface CreateInput {
  prompt: string;
  aspectRatio?: string;
  n?: number;
  saveDir?: string;
}

interface EditInput {
  prompt: string;
  imagePath: string;
  model?: string;
  n?: number;
  saveDir?: string;
}

interface XaiImage {
  b64_json: string;
  mime_type?: string;
  revised_prompt?: string;
}

export default function xai(rl: RunlinePluginAPI) {
  rl.setName("xai");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "xAI API key",
      env: "XAI_API_KEY",
    },
  });

  rl.registerAction("image.create", {
    access: "write",
    description:
      "Generate an image with xAI Grok Imagine (Aurora). Writes the JPEG(s) to disk and returns their file `path`s (plus any revised prompt) — not base64. Deliver each with send_file using its `path`.",
    inputSchema: {
      prompt: {
        type: "string",
        required: true,
        description: "Detailed description of the image",
      },
      saveDir: {
        type: "string",
        required: false,
        description: "Directory to write the image file(s) into. Defaults to the OS temp dir.",
      },
      aspectRatio: {
        type: "string",
        required: false,
        description:
          "1:1 | 16:9 | 9:16 | 4:3 | 3:4 | 3:2 | 2:3 | auto (default: auto)",
      },
      n: {
        type: "number",
        required: false,
        description: "Number of images (default: 1, max: 10)",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as CreateInput;
      if (typeof p.prompt !== "string" || p.prompt.length === 0) {
        throw new Error("xai: prompt is required");
      }

      const apiKey = ctx.connection.config.apiKey as string;
      const body: Record<string, unknown> = {
        model: MODEL,
        prompt: p.prompt,
        n: Math.min(p.n ?? 1, 10),
        response_format: "b64_json",
      };
      if (p.aspectRatio) body.aspect_ratio = p.aspectRatio;

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`xAI API error ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as { data?: XaiImage[] };
      const stamp = Date.now();
      const images = (data.data ?? []).map((d, i) => ({
        ...writeImageFile({ base64: d.b64_json, mimeType: d.mime_type ?? "image/jpeg", provider: "xai", index: i, saveDir: p.saveDir, stamp }),
        ...(d.revised_prompt ? { revisedPrompt: d.revised_prompt } : {}),
      }));
      return { provider: "xai", model: MODEL, images, note: SEND_FILE_NOTE };
    },
  });

  rl.registerAction("image.edit", {
    access: "write",
    description:
      "Edit a local image with xAI Grok Imagine: give the file path and describe the change. Sends the image as a data URI to /v1/images/edits (JSON, not multipart), writes the edited image(s) to disk, and returns their file `path`s — not base64. Deliver each with send_file using its `path`.",
    inputSchema: {
      prompt: {
        type: "string",
        required: true,
        description: "Instruction describing the edit to apply",
      },
      imagePath: {
        type: "string",
        required: true,
        description: "Path to the source image file",
      },
      saveDir: {
        type: "string",
        required: false,
        description: "Directory to write the image file(s) into. Defaults to the OS temp dir.",
      },
      model: {
        type: "string",
        required: false,
        description: "Edit-capable model (default: grok-imagine-image-2.0)",
      },
      n: {
        type: "number",
        required: false,
        description: "Number of edited variants (default: 1, max: 10)",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as EditInput;
      if (typeof p.prompt !== "string" || p.prompt.length === 0) {
        throw new Error("xai: prompt is required");
      }
      const img = readImageInput(p.imagePath, "xai");

      const apiKey = ctx.connection.config.apiKey as string;
      const model = p.model ?? EDIT_MODEL;

      const res = await fetch(EDIT_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          prompt: p.prompt,
          image: { url: img.dataUri },
          n: Math.min(p.n ?? 1, 10),
          response_format: "b64_json",
        }),
      });
      if (!res.ok) {
        throw new Error(`xAI API error ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as { data?: XaiImage[] };
      const stamp = Date.now();
      const images = (data.data ?? []).map((d, i) => ({
        ...writeImageFile({ base64: d.b64_json, mimeType: d.mime_type ?? "image/jpeg", provider: "xai", index: i, saveDir: p.saveDir, stamp }),
        ...(d.revised_prompt ? { revisedPrompt: d.revised_prompt } : {}),
      }));
      return { provider: "xai", model, images, note: SEND_FILE_NOTE };
    },
  });
}
