/**
 * OpenAI image generation for runline.
 *
 * Wraps the GPT Image / DALL-E line at /v1/images/generations. Generated
 * images are written to disk and the action returns their file `path`s
 * (plus the optional revised prompt) — never raw base64, which bloats the
 * agent context and is stripped before delivery. Hand each `path` to the
 * host's file-sending tool (e.g. send_file) to deliver the image.
 *
 * Quality leader for text rendering and prompt adherence — pair with
 * any other plugin you'd compose images for (storyblok, github,
 * notion, slack uploads, …).
 *
 *   const { images } = await openai.image.create({ prompt: "a red bicycle on snow" })
 *   // images[0].path -> "/tmp/openai-image-….png"
 */

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunlinePluginAPI } from "runline";

const ENDPOINT = "https://api.openai.com/v1/images/generations";

interface CreateInput {
  prompt: string;
  model?: string;
  size?: string;
  quality?: string;
  style?: string;
  n?: number;
  saveDir?: string;
}

interface OpenAIImage {
  b64_json: string;
  revised_prompt?: string;
}

export default function openai(rl: RunlinePluginAPI) {
  rl.setName("openai");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "OpenAI API key",
      env: "OPENAI_API_KEY",
    },
    defaultModel: {
      type: "string",
      required: false,
      description:
        "Default image model when a call omits `model` (e.g. gpt-image-2). Falls back to gpt-image-1.",
      env: "OPENAI_IMAGE_MODEL",
    },
  });

  rl.registerAction("image.create", {
    description:
      "Generate an image with OpenAI (GPT Image / DALL-E). Writes the PNG(s) to disk and returns their file `path`s (plus any revised prompt) — not base64. Deliver each image to the user with send_file using its `path`.",
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
          "gpt-image-2 | gpt-image-1 | gpt-image-1-mini | dall-e-3 | dall-e-2. Omit to use the connection default.",
      },
      size: {
        type: "string",
        required: false,
        description: "WxH (default: 1024x1024). Allowed sizes vary by model.",
      },
      quality: {
        type: "string",
        required: false,
        description:
          "low | medium | high (gpt-image) or standard | hd (dall-e-3)",
      },
      style: {
        type: "string",
        required: false,
        description: "vivid | natural — DALL-E 3 only",
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
        throw new Error("openai: prompt is required");
      }

      const apiKey = ctx.connection.config.apiKey as string;
      const model =
        p.model ??
        (ctx.connection.config.defaultModel as string | undefined) ??
        "gpt-image-1";

      const body: Record<string, unknown> = {
        model,
        prompt: p.prompt,
        n: Math.min(p.n ?? 1, 4),
        size: p.size ?? "1024x1024",
      };
      // gpt-image-* uses output_format; dall-e-* uses response_format.
      // Sending the wrong key 400s, so the model name decides.
      if (model.startsWith("dall-e")) {
        body.response_format = "b64_json";
      } else {
        body.output_format = "png";
      }
      if (p.quality) body.quality = p.quality;
      if (p.style) body.style = p.style;

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as { data?: OpenAIImage[] };
      const dir = (typeof p.saveDir === "string" && p.saveDir.trim()) || tmpdir();
      const stamp = Date.now();
      const images = (data.data ?? []).map((d, i) => {
        const bytes = Buffer.from(d.b64_json ?? "", "base64");
        const path = join(dir, `openai-image-${stamp}-${i}.png`);
        writeFileSync(path, bytes);
        return {
          path,
          mimeType: "image/png",
          byteLength: bytes.length,
          ...(d.revised_prompt ? { revisedPrompt: d.revised_prompt } : {}),
        };
      });
      return {
        provider: "openai",
        model,
        images,
        note: "Image(s) written to disk. Deliver each to the user with send_file using its `path`.",
      };
    },
  });
}
