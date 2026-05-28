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
import { SEND_FILE_NOTE, writeImageFile } from "../../_shared/imageFile.js";

const ENDPOINT = "https://api.x.ai/v1/images/generations";
const MODEL = "grok-imagine-image";

interface CreateInput {
  prompt: string;
  aspectRatio?: string;
  n?: number;
  saveDir?: string;
}

interface XaiImage {
  b64_json: string;
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
        ...writeImageFile({ base64: d.b64_json, mimeType: "image/jpeg", provider: "xai", index: i, saveDir: p.saveDir, stamp }),
        ...(d.revised_prompt ? { revisedPrompt: d.revised_prompt } : {}),
      }));
      return { provider: "xai", model: MODEL, images, note: SEND_FILE_NOTE };
    },
  });
}
