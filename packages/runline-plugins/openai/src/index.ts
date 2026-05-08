/**
 * OpenAI image generation for runline.
 *
 * Wraps the GPT Image / DALL-E line at /v1/images/generations and
 * returns base64 bytes alongside the (optional) revised prompt the
 * model wrote for itself.
 *
 * Quality leader for text rendering and prompt adherence — pair with
 * any other plugin you'd compose images for (storyblok, github,
 * notion, slack uploads, …).
 *
 *   await openai.image.create({ prompt: "a red bicycle on snow" })
 *   await openai.image.create({
 *     prompt: "logo for a coffee shop",
 *     model: "dall-e-3",
 *     style: "vivid",
 *     quality: "high",
 *     size: "1024x1024",
 *   })
 */

import type { RunlinePluginAPI } from "runline";

const ENDPOINT = "https://api.openai.com/v1/images/generations";

interface CreateInput {
  prompt: string;
  model?: string;
  size?: string;
  quality?: string;
  style?: string;
  n?: number;
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
  });

  rl.registerAction("image.create", {
    description:
      "Generate an image with OpenAI (GPT Image / DALL-E). Returns base64-encoded PNGs and any revised prompt the model produced.",
    inputSchema: {
      prompt: {
        type: "string",
        required: true,
        description: "Detailed description of the image",
      },
      model: {
        type: "string",
        required: false,
        description:
          "gpt-image-1 (default) | gpt-image-1-mini | dall-e-3 | dall-e-2",
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
      const model = p.model ?? "gpt-image-1";

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
      const images = (data.data ?? []).map((d) => ({
        base64: d.b64_json,
        mimeType: "image/png",
        ...(d.revised_prompt ? { revisedPrompt: d.revised_prompt } : {}),
      }));
      return { provider: "openai", model, images };
    },
  });
}
