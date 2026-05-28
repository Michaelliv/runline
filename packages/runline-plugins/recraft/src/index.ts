/**
 * Recraft image generation for runline.
 *
 *   await recraft.image.create({ prompt: "minimalist line-art coffee cup" })
 *   await recraft.image.create({
 *     prompt: "rocket logo, flat vector",
 *     model: "recraftv3_vector",   // → SVG
 *     style: "Vector art",
 *   })
 *
 * Recraft is the design-oriented provider: vector output, brand-
 * consistent style libraries, typography-aware. V4 models drop the
 * legacy `style` knob — pass `styleId` against your own custom
 * style if you've set one up.
 */

import type { RunlinePluginAPI } from "runline";
import { SEND_FILE_NOTE, writeImageFile } from "../../_shared/imageFile.js";

const ENDPOINT = "https://external.api.recraft.ai/v1/images/generations";

interface CreateInput {
  prompt: string;
  model?: string;
  style?: string;
  styleId?: string;
  size?: string;
  n?: number;
  saveDir?: string;
}

interface RecraftImage {
  b64_json: string;
}

export default function recraft(rl: RunlinePluginAPI) {
  rl.setName("recraft");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Recraft API key",
      env: "RECRAFT_API_KEY",
    },
  });

  rl.registerAction("image.create", {
    description:
      "Generate an image with Recraft. Best for design, vector graphics, and brand-consistent work. Writes the image(s) to disk and returns their file `path`s — not base64. Deliver each with send_file using its `path`.",
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
          "recraftv3 (default) | recraftv3_vector | recraftv4 | recraftv4_pro | recraftv4_vector | recraftv4_pro_vector",
      },
      style: {
        type: "string",
        required: false,
        description:
          "V2/V3 only — Photorealism | Illustration | Vector art | Hand-drawn | Icon | Recraft V3 Raw",
      },
      styleId: {
        type: "string",
        required: false,
        description: "ID of a custom style created in your Recraft account",
      },
      size: {
        type: "string",
        required: false,
        description: "WxH (default: 1024x1024). E.g. 1280x1024, 1024x1280",
      },
      n: {
        type: "number",
        required: false,
        description: "Number of images (default: 1, max: 6)",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as CreateInput;
      if (typeof p.prompt !== "string" || p.prompt.length === 0) {
        throw new Error("recraft: prompt is required");
      }

      const apiKey = ctx.connection.config.apiKey as string;
      const model = p.model ?? "recraftv3";

      const body: Record<string, unknown> = {
        prompt: p.prompt,
        model,
        response_format: "b64_json",
        n: Math.min(p.n ?? 1, 6),
      };
      if (p.size) body.size = p.size;
      if (p.style) body.style = p.style;
      if (p.styleId) body.style_id = p.styleId;

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`Recraft API error ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as { data?: RecraftImage[] };
      const stamp = Date.now();
      const images = (data.data ?? []).map((d, i) =>
        writeImageFile({ base64: d.b64_json, mimeType: "image/png", provider: "recraft", index: i, saveDir: p.saveDir, stamp }),
      );
      return { provider: "recraft", model, images, note: SEND_FILE_NOTE };
    },
  });
}
