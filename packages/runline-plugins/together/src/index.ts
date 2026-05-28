/**
 * Together AI image generation for runline.
 *
 *   await together.image.create({ prompt: "a cyberpunk skyline at dusk" })
 *   await together.image.create({
 *     prompt: "studio product shot, white background",
 *     model: "black-forest-labs/FLUX.1-dev",
 *     steps: 28,
 *   })
 *
 * Default model is FLUX.1-schnell — fastest, 4 steps. For better
 * fidelity switch to FLUX.1-dev / Ideogram / Qwen-Image and bump
 * `steps` accordingly (20–30 is typical for non-schnell models).
 */

import type { RunlinePluginAPI } from "runline";
import { SEND_FILE_NOTE, writeImageFile } from "../../_shared/imageFile.js";
import { parseSize } from "../../_shared/parseSize.js";

const ENDPOINT = "https://api.together.xyz/v1/images/generations";

interface CreateInput {
  prompt: string;
  model?: string;
  size?: string;
  steps?: number;
  n?: number;
  saveDir?: string;
}

interface TogetherImage {
  b64_json: string;
}

export default function together(rl: RunlinePluginAPI) {
  rl.setName("together");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Together AI API key",
      env: "TOGETHER_API_KEY",
    },
  });

  rl.registerAction("image.create", {
    description:
      "Generate an image with Together AI (Flux, Ideogram, Qwen-Image, …). Writes the image(s) to disk and returns their file `path`s — not base64. Deliver each with send_file using its `path`.",
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
      model: {
        type: "string",
        required: false,
        description:
          "Together model id, e.g. black-forest-labs/FLUX.1-schnell (default), black-forest-labs/FLUX.1-dev, ideogram/ideogram-3.0, Qwen/Qwen-Image",
      },
      size: {
        type: "string",
        required: false,
        description: "WxH (default: 1024x1024)",
      },
      steps: {
        type: "number",
        required: false,
        description:
          "Inference steps (default: 4 for FLUX.1-schnell). Use 20–30 for FLUX.1-dev or Ideogram.",
      },
      n: {
        type: "number",
        required: false,
        description: "Number of images (default: 1, max: 4)",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as CreateInput;
      if (typeof p.prompt !== "string" || p.prompt.length === 0) {
        throw new Error("together: prompt is required");
      }

      const apiKey = ctx.connection.config.apiKey as string;
      const model = p.model ?? "black-forest-labs/FLUX.1-schnell";
      const { width, height } = parseSize(p.size, "together");

      const body: Record<string, unknown> = {
        model,
        prompt: p.prompt,
        width,
        height,
        steps: p.steps ?? 4,
        n: Math.min(p.n ?? 1, 4),
        response_format: "base64",
      };

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(
          `Together API error ${res.status}: ${await res.text()}`,
        );
      }

      const data = (await res.json()) as { data?: TogetherImage[] };
      const stamp = Date.now();
      const images = (data.data ?? []).map((d, i) =>
        writeImageFile({ base64: d.b64_json, mimeType: "image/png", provider: "together", index: i, saveDir: p.saveDir, stamp }),
      );
      return { provider: "together", model, images, note: SEND_FILE_NOTE };
    },
  });
}
