/**
 * Google Gemini image generation (Nano Banana / Imagen) for runline.
 *
 * Distinct from the rest of the googleX family — those wrap Workspace
 * APIs over OAuth2, this one wraps Generative Language over a single
 * API key. Kept under the `googleImage` namespace so it doesn't
 * collide with `googleDrive`, `googleDocs`, etc.
 *
 *   await googleImage.image.create({ prompt: "a watercolor fox" })
 *   await googleImage.image.create({
 *     prompt: "edit: make the sky stormier",
 *     model: "gemini-3-pro-image-preview",
 *   })
 *
 * Nano Banana supports conversational editing — chain prompts in
 * follow-up calls and it'll keep iterating on the last image.
 */

import type { RunlinePluginAPI } from "runline";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface CreateInput {
  prompt: string;
  model?: string;
}

interface GeminiPart {
  inlineData?: { data: string; mimeType?: string };
  text?: string;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
}

export default function googleImage(rl: RunlinePluginAPI) {
  rl.setName("googleImage");
  rl.setVersion("0.1.0");

  rl.setConnectionSchema({
    apiKey: {
      type: "string",
      required: true,
      description: "Google AI API key (Gemini)",
      env: "GOOGLE_API_KEY",
    },
  });

  rl.registerAction("image.create", {
    description:
      "Generate an image with Google's Gemini image models (Nano Banana / Imagen). Returns base64 bytes per candidate.",
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
          "gemini-2.5-flash-image (Nano Banana, default) | gemini-3-pro-image-preview | gemini-3.1-flash-image-preview",
      },
    },
    async execute(input, ctx) {
      const p = (input ?? {}) as CreateInput;
      if (typeof p.prompt !== "string" || p.prompt.length === 0) {
        throw new Error("googleImage: prompt is required");
      }

      const apiKey = ctx.connection.config.apiKey as string;
      const model = p.model ?? "gemini-2.5-flash-image";

      const url = `${BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const body = {
        contents: [{ parts: [{ text: p.prompt }] }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new Error(`Google API error ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as GeminiResponse;
      const images: Array<{ base64: string; mimeType: string }> = [];
      for (const candidate of data.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (part.inlineData?.data) {
            images.push({
              base64: part.inlineData.data,
              mimeType: part.inlineData.mimeType ?? "image/png",
            });
          }
        }
      }
      return { provider: "googleImage", model, images };
    },
  });
}
